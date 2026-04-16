#!/usr/bin/env python3
"""
Stage 1 Case 1 — Independent follow-up test.

Builds two transcripts:
  - case1_full.txt      = filler + synth_report + followup
  - case1_stripped.txt  = filler + report-placeholder + followup

Both end with the same followup user message. We dispatch one subagent per
variant and compare the responses.
"""

import json
import os
from pathlib import Path


OUT = Path(__file__).parent
FILLER_SESSION = (
    "/Users/laonpeople/.claude/projects/"
    "-Users-laonpeople-dev-ezplanet-portal-gateway-web/"
    "652d855b-c87d-49ae-ba91-42957b485f9f.jsonl"
)
FILLER_CHAR_TARGET = 150_000  # aim for ~150K chars of pre-report history


SYNTH_USER_REQUEST = (
    "잠깐 다른 걸 부탁하자. 우리 포털 auth 시스템 아키텍처 리뷰를 "
    "상세하게 써줘 — 현재 구조, 취약점, 개선안 포함해서."
)


# ~6000 chars of "fake detailed architectural review" — the stripping target.
SYNTH_ASSISTANT_REPORT = """# EZ-PLANET Portal Auth System — Architecture Review

## 1. 현재 아키텍처 개요

포털 gateway auth는 다음 4개 레이어로 구성되어 있음:

### 1.1 Edge layer (Nginx + Lua)
- 요청 인입 시 JWT 검증 (RS256)
- Rate limiting: IP당 100 req/min, user당 1000 req/min
- CSP header, HSTS 강제
- 이슈: Lua script가 cache invalidation 없이 5분간 key 캐시 → key rotation 시 최대 5분 delay

### 1.2 Auth gateway (Spring Cloud Gateway)
- Access token 검증, refresh token rotation 책임
- SecurityFilterChain 2단: public path bypass / 나머지 JWT 필터
- 토큰 저장 전략: access in-memory (5min TTL), refresh Redis (30 days)
- 이슈: Spring Security 6.2로 업그레이드 후 WebFlux reactive chain에서 principal propagation이 간헐적으로 누락

### 1.3 Identity service (Spring Boot 3.3)
- 자체 구현 OIDC provider
- 사용자 DB: PostgreSQL 15, user_profile 테이블 약 240만 row
- MFA: TOTP (RFC 6238), 백업 코드 10개 단방향 해시 저장
- 이슈:
  - 비밀번호 정책 validator가 서버/클라이언트 중복 구현 — 불일치 사례 발견
  - bcrypt cost factor = 10 (2020년 설정, 현재 기준 12가 권장)

### 1.4 Session cache (Redis cluster)
- 3-node cluster, replication factor 2
- 세션 TTL: sliding 30 min
- 이슈: cluster failover 시 session eviction 발생 사례 월 1-2회 보고됨

## 2. 발견된 주요 취약점

**V-01 (critical)** — refresh token rotation 로직의 race condition. 동일 refresh token으로 병렬 갱신 요청 시 양쪽 다 새 토큰 발급 가능. POC 재현 성공.

**V-02 (high)** — MFA 백업 코드가 단방향 해시만 저장 — 정책상 사용 후 무효화되어야 하는데 현재는 10번까지 재사용 가능. 규정 위반.

**V-03 (high)** — password reset 토큰 TTL이 24h. 업계 표준(15-30분) 대비 위험. 토큰 DB 테이블에 인덱스 없음 → 만료 cleanup cron이 full scan.

**V-04 (medium)** — admin 페이지 CSRF 토큰 검증이 POST만 커버. PUT/DELETE 경로에서 bypass 가능. 영향은 이미 XSS 방어에 의존 중.

**V-05 (medium)** — 로그인 실패 횟수 카운터가 Redis sliding window인데 Redis 장애 시 fail-open. Brute-force 창 발생 가능.

**V-06 (low)** — CORS allowlist에 `*.dev.ezplanet.com` wildcard가 남아있음. prod에도 동일 config 배포되고 있음.

## 3. 성능 병목

- Identity service의 `/oauth/token` 엔드포인트 p99 latency 480ms (target <200ms). 원인은 PBKDF2 기반 legacy password hashing을 bcrypt로 점진적 migration 중인 dual-path 코드.
- JWT 발급 시마다 RS256 서명 — HSM 없이 JVM keystore 사용 중. 단일 pod에서 초당 약 200 signatures가 CPU bound.
- Redis session write가 replication sync 완료 후 ack — 평균 write latency 8ms, p99 25ms. async replication으로 전환하면 0.5ms로 줄어들지만 consistency tradeoff.

## 4. 개선안 (우선순위별)

### P0 (즉시)
1. V-01 race condition fix — refresh token rotation에 Redis SETNX lock 적용, atomic 보장
2. V-02 MFA 백업 코드 일회용화 — `backup_code_used_at` column 추가, 사용 시 mark
3. bcrypt cost 10 → 12 migration — 신규 가입만 우선 적용, 기존은 로그인 시 lazy rehash

### P1 (4주 내)
4. V-03 password reset 토큰 TTL 30분으로 단축 + expires_at 인덱스 생성
5. V-05 brute-force 카운터 fail-closed로 전환 — Redis 장애 시 로그인 거부 또는 내부 fallback 카운터 활용
6. JWT 서명 HSM 도입 검토 — AWS CloudHSM 또는 자체 HSM. 비용 검토 별도

### P2 (8주 내)
7. V-04 CSRF 검증 전 메서드 커버리지 확장
8. V-06 CORS allowlist prod/dev 분리
9. Auth gateway reactive chain principal propagation 이슈 재현 + 수정
10. Legacy PBKDF2 → bcrypt migration 완료 (현재 약 18% 잔존)

## 5. 관찰된 운영 이슈

- key rotation 절차가 문서화되어 있지 않음 — 과거 rotation 시 edge Lua cache로 인한 5분 downtime 발생
- auth 관련 로그가 3개 서비스에 분산 — 상관 추적 어려움. correlation ID는 있으나 Kibana index가 서비스별로 분리되어 있음
- alerting rule이 latency 기반만. 인증 실패율 spike나 MFA 우회 시도 탐지 규칙 없음

## 6. 제안하는 로드맵

단기(4주): V-01/V-02/bcrypt cost migration.
중기(8주): V-03/V-04/V-05, HSM PoC.
장기(12주+): reactive chain 리팩토링, logging unification, legacy PBKDF2 제거 완료.

총 예상 공수: 인력 2-3명 × 12주 = 24-36 person-weeks.
"""


SYNTH_FOLLOWUP_USER = (
    "OK 주제 바꾸자. timezone 설정을 변경해도 date picker 컴포넌트가 "
    "즉시 업데이트 안 되는 버그 있어. 컴포넌트는 "
    "apps/portal-web/src/components/DatePicker.tsx 에 있고 "
    "timezone context는 apps/portal-web/src/contexts/TzContext.tsx 에 있어. "
    "원인 추정해서 fix 방향 제안해줘."
)


def extract_text(msg_content):
    if isinstance(msg_content, str):
        return msg_content
    if isinstance(msg_content, list):
        parts = []
        for block in msg_content:
            if not isinstance(block, dict):
                continue
            bt = block.get("type")
            if bt == "text":
                parts.append(block.get("text", ""))
            elif bt == "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {})
                parts.append(
                    f"[tool_use:{name}] " + json.dumps(inp, ensure_ascii=False)[:400]
                )
            elif bt == "tool_result":
                content = block.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                parts.append(f"[tool_result] {str(content)[:800]}")
        return "\n".join(parts)
    return str(msg_content)


def load_session_turns(path):
    turns = []
    for line in open(path, errors="ignore"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") not in ("user", "assistant"):
            continue
        m = d.get("message", {})
        if not isinstance(m, dict):
            continue
        text = extract_text(m.get("content", ""))
        if not text.strip():
            continue
        turns.append({"role": m.get("role", d["type"]), "text": text})
    return turns


def render_turns(turns):
    lines = []
    for i, t in enumerate(turns):
        lines.append(f"=== {t['role'].upper()} (turn {i}) ===")
        lines.append(t["text"])
        lines.append("")
    return "\n".join(lines)


def main():
    turns = load_session_turns(FILLER_SESSION)
    print(f"loaded {len(turns)} filler turns from {Path(FILLER_SESSION).name}")

    # truncate to ~FILLER_CHAR_TARGET chars
    running = 0
    cutoff = len(turns)
    for i, t in enumerate(turns):
        running += len(t["text"]) + 40  # overhead for role header
        if running >= FILLER_CHAR_TARGET:
            cutoff = i + 1
            break
    filler = turns[:cutoff]
    filler_rendered = render_turns(filler)
    print(f"filler truncated to {cutoff} turns, ~{len(filler_rendered):,} chars")

    # synth section — full variant
    synth_full = [
        {"role": "user", "text": SYNTH_USER_REQUEST},
        {"role": "assistant", "text": SYNTH_ASSISTANT_REPORT},
        {"role": "user", "text": SYNTH_FOLLOWUP_USER},
    ]
    full_rendered = filler_rendered + "\n" + render_turns(synth_full)

    # synth section — stripped variant
    stripped_report = (
        "[report:arch-review-auth] EZ-PLANET Portal Auth System — Architecture Review\n"
        "(6,000-char detailed architectural review body stripped for benchmark "
        "treatment variant; covered layers Edge/Gateway/Identity/Redis, 6 "
        "vulnerabilities V-01..V-06 with P0/P1/P2 roadmap)"
    )
    synth_stripped = [
        {"role": "user", "text": SYNTH_USER_REQUEST},
        {"role": "assistant", "text": stripped_report},
        {"role": "user", "text": SYNTH_FOLLOWUP_USER},
    ]
    stripped_rendered = filler_rendered + "\n" + render_turns(synth_stripped)

    (OUT / "case1_full.txt").write_text(full_rendered)
    (OUT / "case1_stripped.txt").write_text(stripped_rendered)
    (OUT / "case1_followup.txt").write_text(SYNTH_FOLLOWUP_USER)
    (OUT / "case1_report_body.txt").write_text(SYNTH_ASSISTANT_REPORT)
    (OUT / "case1_report_stripped.txt").write_text(stripped_report)

    meta = {
        "case": "case1_independent_followup",
        "filler_source": FILLER_SESSION,
        "filler_turns": cutoff,
        "filler_chars": len(filler_rendered),
        "full_variant_chars": len(full_rendered),
        "stripped_variant_chars": len(stripped_rendered),
        "char_reduction": len(full_rendered) - len(stripped_rendered),
        "reduction_pct": (len(full_rendered) - len(stripped_rendered))
        / max(len(full_rendered), 1)
        * 100,
        "report_body_chars": len(SYNTH_ASSISTANT_REPORT),
        "stripped_report_chars": len(stripped_report),
        "followup_chars": len(SYNTH_FOLLOWUP_USER),
    }
    (OUT / "case1_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    print()
    print("=== Case 1 built ===")
    for k, v in meta.items():
        if isinstance(v, float):
            print(f"  {k}: {v:.2f}")
        elif isinstance(v, int):
            print(f"  {k}: {v:,}")
        else:
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
