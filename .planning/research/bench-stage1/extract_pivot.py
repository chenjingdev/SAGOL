#!/usr/bin/env python3
"""
Stage 1 benchmark — pivot extraction.

For a given JSONL session file, find a pivot point where:
  - Turn N = assistant produces a long "report-like" response (output ≥ 1000 tokens, structured)
  - Turn N+1 = user sends follow-up
  - Turn N+2 = assistant responds (this is R_base, the baseline we compare against)

Output four files per session:
  - <slug>_context_full.txt       : conversation history up to and including user turn N+1 (unstripped)
  - <slug>_context_stripped.txt   : same history but turn N's body replaced with [report:<id>] summary placeholder
  - <slug>_followup.txt           : the user's follow-up message (turn N+1 text) — for reference
  - <slug>_baseline.txt           : R_base — the assistant's actual response to the follow-up (turn N+2 text)

Usage: python3 extract_pivot.py <session_jsonl_path> <output_slug>
"""

import json
import sys
import os
import re
from pathlib import Path


def extract_text(msg_content):
    """Extract human-readable text from a message.content field (str or list of blocks)."""
    if isinstance(msg_content, str):
        return msg_content
    if isinstance(msg_content, list):
        parts = []
        for block in msg_content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                parts.append(block.get("text", ""))
            elif btype == "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {})
                parts.append(f"[tool_use:{name}] " + json.dumps(inp, ensure_ascii=False)[:500])
            elif btype == "tool_result":
                content = block.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                parts.append(f"[tool_result] {str(content)[:500]}")
            elif btype == "thinking":
                # skip thinking blocks from context reconstruction
                pass
        return "\n".join(parts)
    return str(msg_content)


def load_session(path):
    """Load JSONL, return only the user/assistant turns in order."""
    turns = []
    for line in open(path, errors="ignore"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        t = d.get("type")
        if t not in ("user", "assistant"):
            continue
        m = d.get("message", {})
        if not isinstance(m, dict):
            continue
        role = m.get("role", t)
        content = m.get("content", "")
        text = extract_text(content)
        if not text.strip():
            continue
        usage = m.get("usage", {}) if isinstance(m.get("usage"), dict) else {}
        out_tokens = usage.get("output_tokens", 0) if t == "assistant" else 0
        ctx_tokens = (
            (usage.get("input_tokens", 0) or 0)
            + (usage.get("cache_creation_input_tokens", 0) or 0)
            + (usage.get("cache_read_input_tokens", 0) or 0)
        )
        turns.append(
            {
                "role": role,
                "text": text,
                "out_tokens": out_tokens,
                "ctx_tokens": ctx_tokens,
                "uuid": d.get("uuid", ""),
            }
        )
    return turns


REPORT_PATTERN = re.compile(r"(^#{1,3}\s|^\*\*|^\|.*\|)", re.MULTILINE)


def score_report_like(turn):
    """Higher = more report-like. Criteria: char length, structured markdown density."""
    if turn["role"] != "assistant":
        return 0
    text = turn["text"].strip()
    # skip already-stripped reports (sagol v1 marker)
    if text.startswith("[report:"):
        return 0
    # skip pure tool-call turns (nothing to strip)
    if text.startswith("[tool_use:") or text.startswith("[tool_result]"):
        return 0
    # require substantial body worth stripping (≥ 3000 chars ≈ ~750 tokens)
    if len(text) < 3000:
        return 0
    # count structural markdown markers (headers, bold lines, table rows)
    struct_hits = len(REPORT_PATTERN.findall(text))
    # score: length dominates, structure is a tiebreaker
    return len(text) + struct_hits * 100


def find_pivot(turns):
    """Find the best (turn_N_idx, follow_up_idx, baseline_idx) triple."""
    best = None
    for i in range(len(turns) - 2):
        t_n = turns[i]
        t_n1 = turns[i + 1]
        t_n2 = turns[i + 2]
        if t_n["role"] != "assistant":
            continue
        if t_n1["role"] != "user":
            continue
        if t_n2["role"] != "assistant":
            continue
        # require N+1 to be a substantial user request (not a tool result echo)
        if t_n1["text"].startswith("[tool_result]"):
            continue
        if len(t_n1["text"]) < 20:
            continue
        # require N+2 to have text response (not just tool calls)
        if not any(
            not line.startswith(("[tool_use:", "[tool_result]"))
            and line.strip()
            for line in t_n2["text"].splitlines()
        ):
            continue
        score = score_report_like(t_n)
        if score == 0:
            continue
        if best is None or score > best[0]:
            best = (score, i, i + 1, i + 2)
    return best


def make_stripped_summary(report_text, report_id):
    """Replace report body with a placeholder summary."""
    first_line = report_text.strip().split("\n")[0][:80]
    # use first heading/line as "title", placeholder summary
    return (
        f"[report:{report_id}] {first_line}\n"
        f"(report body of ~{len(report_text)} chars stripped for benchmark treatment)"
    )


def render_conversation(turns, up_to_idx, strip_idx=None, strip_text=None):
    """Render turns[0..up_to_idx] as a conversation log. Optionally replace strip_idx turn body."""
    lines = []
    for i, t in enumerate(turns[: up_to_idx + 1]):
        role = t["role"].upper()
        if i == strip_idx and strip_text is not None:
            body = strip_text
        else:
            body = t["text"]
        lines.append(f"=== {role} (turn {i}) ===")
        lines.append(body)
        lines.append("")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 3:
        print("usage: extract_pivot.py <session.jsonl> <slug>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    slug = sys.argv[2]

    out_dir = Path(__file__).parent
    turns = load_session(path)
    if not turns:
        print(f"[{slug}] no turns loaded", file=sys.stderr)
        sys.exit(1)

    pivot = find_pivot(turns)
    if not pivot:
        print(f"[{slug}] no pivot found", file=sys.stderr)
        sys.exit(1)

    score, n_idx, f_idx, b_idx = pivot
    t_n = turns[n_idx]
    t_f = turns[f_idx]
    t_b = turns[b_idx]

    report_id = t_n["uuid"][:8] if t_n.get("uuid") else f"{slug}-N{n_idx}"
    stripped_text = make_stripped_summary(t_n["text"], report_id)

    context_full = render_conversation(turns, f_idx, strip_idx=None)
    context_stripped = render_conversation(
        turns, f_idx, strip_idx=n_idx, strip_text=stripped_text
    )

    (out_dir / f"{slug}_context_full.txt").write_text(context_full)
    (out_dir / f"{slug}_context_stripped.txt").write_text(context_stripped)
    (out_dir / f"{slug}_followup.txt").write_text(t_f["text"])
    (out_dir / f"{slug}_baseline.txt").write_text(t_b["text"])

    # metadata
    meta = {
        "slug": slug,
        "source": path,
        "pivot_turn_N": n_idx,
        "pivot_turn_followup": f_idx,
        "pivot_turn_baseline": b_idx,
        "report_score": score,
        "report_output_tokens": t_n["out_tokens"],
        "report_len_chars": len(t_n["text"]),
        "stripped_len_chars": len(stripped_text),
        "followup_len_chars": len(t_f["text"]),
        "baseline_len_chars": len(t_b["text"]),
        "context_full_len_chars": len(context_full),
        "context_stripped_len_chars": len(context_stripped),
        "context_tokens_at_pivot": t_n["ctx_tokens"],
    }
    (out_dir / f"{slug}_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    print(f"[{slug}] pivot found at turn {n_idx}")
    print(f"  report output tokens:  {t_n['out_tokens']:,}")
    print(f"  report length (chars): {len(t_n['text']):,}")
    print(f"  context_full:          {len(context_full):,} chars")
    print(f"  context_stripped:      {len(context_stripped):,} chars")
    print(f"  char reduction:        {len(context_full) - len(context_stripped):,} chars ({100 * (len(context_full) - len(context_stripped)) / max(len(context_full), 1):.1f}%)")


if __name__ == "__main__":
    main()
