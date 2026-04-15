#!/usr/bin/env bun
/**
 * SAGOL Stop hook — turn 압축.
 *
 * 턴 종료 시 JSONL을 다시 써서:
 *   User message (real, not tool_result)
 *   → Assistant: [thinking, tool_use, tool_result, thinking, ... text]
 *
 * 를 다음으로 collapse:
 *
 *   User message
 *   → Assistant: [text only — last_assistant_message from hook input]
 *
 * 주의:
 * - CC의 in-memory 상태는 바꾸지 못함. 다음 턴에 CC가 JSONL을 fresh 읽을 때 반영
 * - 수정 지점 이후 캐시는 무효화됨 (prefix는 보존됨)
 * - 실패 시 조용히 passthrough (절대 CC를 blocking하지 않음)
 *
 * Log: /tmp/sagol-stop-strip.log
 */

import { randomUUID } from "node:crypto";

const LOG = "/tmp/sagol-stop-strip.log";

async function appendLog(msg: string) {
  const file = Bun.file(LOG);
  const prev = await file.exists() ? await file.text() : "";
  await Bun.write(LOG, prev + `${new Date().toISOString()} ${msg}\n`);
}

function fail(msg: string): never {
  appendLog(`[skip] ${msg}`);
  process.exit(0); // passthrough
}

type Entry = {
  uuid?: string;
  parentUuid?: string;
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  userType?: string;
  entrypoint?: string;
  timestamp?: string;
  isSidechain?: boolean;
};

function isRealUserMessage(e: Entry): boolean {
  if (e.type !== "user") return false;
  const c = e.message?.content;
  if (typeof c === "string") return true;
  if (!Array.isArray(c)) return false;
  // tool_result reply = not real user message
  for (const block of c as Array<{ type?: string }>) {
    if (block?.type === "tool_result") return false;
  }
  return true;
}

async function main() {
  let raw: string;
  try {
    raw = await Bun.stdin.text();
  } catch (e) {
    fail(`stdin err: ${String(e)}`);
  }
  if (!raw.trim()) fail("empty stdin");

  let input: {
    transcript_path?: string;
    last_assistant_message?: string;
    stop_hook_active?: boolean;
    session_id?: string;
  };
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`json err: ${String(e)}`);
  }

  // 무한 루프 방지
  if (input.stop_hook_active) fail("stop_hook_active=true, skip");

  const path = input.transcript_path;
  if (!path) fail("no transcript_path");

  const lastText = input.last_assistant_message ?? "";
  if (!lastText.trim()) fail("no last_assistant_message");

  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch (e) {
    fail(`read err: ${String(e)}`);
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const entries: Entry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      fail(`parse err in line`);
    }
  }

  if (entries.length === 0) fail("empty jsonl");

  // 마지막 real user message 찾기 = 턴 시작
  let turnStart = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealUserMessage(entries[i]!)) {
      turnStart = i;
      break;
    }
  }
  if (turnStart < 0) fail("no real user message found");

  // 턴 시작 이후에 실제로 뭔가가 있어야 함 (stripping 할 의미)
  const turnLen = entries.length - turnStart - 1;
  if (turnLen <= 1) fail(`turn len=${turnLen}, nothing to strip`);

  // 턴 시작까지 유지
  const kept = entries.slice(0, turnStart + 1);
  const userEntry = entries[turnStart]!;

  // 새 assistant 메시지 1개만 붙임 (last_assistant_message 전용)
  const newAssistant: Entry = {
    parentUuid: userEntry.uuid,
    isSidechain: false,
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: lastText }] as unknown as never,
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: userEntry.sessionId,
    cwd: userEntry.cwd,
    gitBranch: userEntry.gitBranch,
    version: userEntry.version,
    userType: userEntry.userType,
    entrypoint: userEntry.entrypoint,
  };
  kept.push(newAssistant);

  const output = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";

  // 안전: 원본 백업
  const backup = path + ".pre-strip-" + Date.now();
  await Bun.write(backup, content);
  await Bun.write(path, output);

  appendLog(
    `[ok] session=${input.session_id} stripped ${turnLen} entries → 1 text-only, backup=${backup}`,
  );

  process.exit(0);
}

await main();
