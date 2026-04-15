/**
 * SAGOL dashboard — Bun.serve HTTP + WebSocket server.
 *
 * Routes (all auth'd by token in `?t=` query or `X-Sagol-Token` header):
 *   GET  /                       → dashboard HTML
 *   GET  /api/state               → { reports: [...], awaiters: [...] }
 *   GET  /api/report/:id          → { html, frontmatter, bodyLen }
 *   POST /api/await               → { actionId, reportId, prompt? } (MCP-facing)
 *   POST /api/feedback/:actionId  → { kind, text? }                 (browser-facing)
 *   GET  /api/poll/:actionId      → long-poll; returns feedback or 408 (MCP-facing)
 *   WS   /ws                      → live push of report/awaiter events
 *
 * Security: hostname 127.0.0.1, random 64-hex token, URL file 0600. D-24.
 * IPC: MCP server discovers this dashboard via .sagol/dashboard-url.txt. D-21.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chmodSync } from "node:fs";
import type { ServerWebSocket } from "bun";
import { DashContext, type AwaiterFeedback, type ReportEntry } from "./context.ts";
import { startWatcher, scanInitial } from "./watcher.ts";
import { renderDashboardHtml } from "./html.ts";

const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per FB-03

export type DashServerOptions = {
  projectRoot: string;
  benchmarkMode?: boolean;
};

export type RunningDashServer = {
  url: string;
  token: string;
  port: number;
  stop: () => Promise<void>;
};

type WsData = { token: string };

function makeToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

function checkToken(req: Request, expected: string): boolean {
  const url = new URL(req.url);
  const q = url.searchParams.get("t");
  if (q && q === expected) return true;
  const h = req.headers.get("X-Sagol-Token");
  return !!h && h === expected;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function reportDto(e: ReportEntry) {
  return {
    id: e.id,
    title: e.frontmatter.title,
    source: e.frontmatter.source,
    timestamp: e.frontmatter.timestamp,
    summary: e.frontmatter.summary,
    mtimeMs: e.mtimeMs,
    bodyLen: e.bodyLen,
  };
}

async function writeUrlFile(projectRoot: string, line: string): Promise<string> {
  const dir = join(projectRoot, ".sagol");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "dashboard-url.txt");
  await writeFile(path, line + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
  return path;
}

export async function startDashServer(
  opts: DashServerOptions,
): Promise<RunningDashServer> {
  const root = resolve(opts.projectRoot);
  const ctx = new DashContext();
  const reportsDir = join(root, ".sagol", "reports");
  await scanInitial(ctx, reportsDir);

  const token = makeToken();
  const sockets = new Set<ServerWebSocket<WsData>>();

  function broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of sockets) ws.send(data);
  }

  const abort = new AbortController();
  void startWatcher(ctx, reportsDir, ({ entry, isNew }) => {
    broadcast({ type: isNew ? "report:new" : "report:update", report: reportDto(entry) });
  }, abort.signal);

  const server = Bun.serve<WsData, never>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req, srv) => {
      const url = new URL(req.url);
      // Auth first for everything except the websocket upgrade (which checks
      // token inline during upgrade so the 101 handshake happens or doesn't).
      if (url.pathname === "/ws") {
        if (!checkToken(req, token)) return new Response("forbidden", { status: 403 });
        const ok = srv.upgrade(req, { data: { token } });
        return ok ? undefined : new Response("upgrade failed", { status: 500 });
      }
      if (!checkToken(req, token)) return new Response("forbidden", { status: 403 });

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(renderDashboardHtml({ token }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        return json({
          reports: ctx.listReports().map(reportDto),
          awaiters: [...ctx.awaiters.values()].map((a) => ({
            actionId: a.actionId,
            reportId: a.reportId,
            prompt: a.prompt,
            createdAt: a.createdAt,
          })),
          benchmarkMode: !!opts.benchmarkMode,
        });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/report/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/report/".length));
        const r = ctx.reports.get(id);
        if (!r) return new Response("not found", { status: 404 });
        return json({
          id: r.id,
          frontmatter: r.frontmatter,
          html: r.html,
          bodyLen: r.bodyLen,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/await") {
        const body = (await req.json().catch(() => null)) as {
          actionId?: string;
          reportId?: string;
          prompt?: string;
        } | null;
        if (!body?.actionId || !body?.reportId) {
          return new Response("bad request", { status: 400 });
        }
        const a = ctx.registerAwaiter(body.actionId, body.reportId, body.prompt);
        broadcast({
          type: "awaiter:new",
          awaiter: {
            actionId: a.actionId,
            reportId: a.reportId,
            prompt: a.prompt,
            createdAt: a.createdAt,
          },
        });
        return json({ ok: true, actionId: a.actionId }, { status: 202 });
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/feedback/")) {
        const actionId = decodeURIComponent(url.pathname.slice("/api/feedback/".length));
        const body = (await req.json().catch(() => null)) as AwaiterFeedback | null;
        if (!body || !["approve", "reject", "revise"].includes(body.kind)) {
          return new Response("bad request", { status: 400 });
        }
        const status = ctx.submitFeedback(actionId, body);
        if (status === "unknown") return new Response("unknown actionId", { status: 404 });
        if (status === "ok") {
          broadcast({ type: "awaiter:resolved", actionId });
        }
        return json({ status });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/poll/")) {
        const actionId = decodeURIComponent(url.pathname.slice("/api/poll/".length));
        const a = ctx.awaiters.get(actionId);
        if (!a) return new Response("unknown actionId", { status: 404 });
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), POLL_TIMEOUT_MS));
        const result = await Promise.race([a.pending, timeout]);
        if (!result) {
          ctx.expireAwaiter(actionId);
          return new Response("timeout", { status: 408 });
        }
        return json({ feedback: result });
      }

      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {
        /* client-push not used in v1 */
      },
    },
  });

  const port = server.port ?? 0;
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  await writeUrlFile(root, url);

  return {
    url,
    token,
    port,
    stop: async () => {
      abort.abort();
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      server.stop(true);
    },
  };
}
