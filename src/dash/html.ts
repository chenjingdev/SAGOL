/**
 * SAGOL dashboard — HTML template builder.
 *
 * Returns a complete HTML string with:
 *   - Preact + HTM loaded via import map from esm.sh (D-27, no build step)
 *   - highlight.js CSS theme loaded from jsdelivr
 *   - Inline CSS (minimal, dark theme)
 *   - Inline JS that opens a WebSocket and renders the UI reactively
 *
 * The dashboard is a single page with:
 *   - Left sidebar: list of reports (newest first)
 *   - Right pane: selected report's compiled HTML
 *   - Floating awaiter modal: shown when a pending feedback request arrives
 */
export function renderDashboardHtml(args: { token: string }): string {
  const { token } = args;
  const jsonToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SAGOL Dashboard</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css" />
<style>
  :root {
    --bg: #0e0f12;
    --panel: #15171c;
    --panel-hi: #1c1f26;
    --border: #2a2e38;
    --fg: #e6e8ec;
    --muted: #8b90a0;
    --accent: #9ecbff;
    --danger: #f28b82;
    --ok: #8bd5a1;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  }
  #root { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
  aside {
    border-right: 1px solid var(--border);
    background: var(--panel);
    overflow-y: auto;
  }
  aside h1 {
    margin: 0; padding: 14px 16px; font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid var(--border);
  }
  aside h1 .bm { color: var(--danger); margin-left: 8px; font-size: 11px; }
  .rli {
    padding: 10px 16px; border-bottom: 1px solid var(--border); cursor: pointer;
  }
  .rli:hover { background: var(--panel-hi); }
  .rli.sel { background: var(--panel-hi); border-left: 3px solid var(--accent); padding-left: 13px; }
  .rli .t { font-weight: 600; color: var(--fg); }
  .rli .m { color: var(--muted); font-size: 12px; margin-top: 2px; }
  main { overflow-y: auto; padding: 24px 32px 80px; }
  main .empty { color: var(--muted); padding-top: 80px; text-align: center; }
  main .body { max-width: 880px; }
  main .fm {
    color: var(--muted); font-size: 12px; margin-bottom: 16px;
    border-bottom: 1px solid var(--border); padding-bottom: 12px;
  }
  main .fm .title {
    color: var(--fg); font-size: 22px; font-weight: 700; margin-bottom: 4px; display: block;
  }
  main pre { padding: 0; }
  main pre.hljs { padding: 14px 16px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; }
  main code { background: #1c1f26; padding: 1px 5px; border-radius: 3px; font-size: 12.5px; }
  main pre.hljs code { background: transparent; padding: 0; }
  main h1, main h2, main h3 { margin-top: 1.8em; }
  main h2 { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  main a { color: var(--accent); }
  main blockquote {
    border-left: 3px solid var(--border); margin: 0; padding: 2px 14px;
    color: var(--muted);
  }
  .awaiter-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex;
    align-items: center; justify-content: center; z-index: 100;
  }
  .awaiter {
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px 24px; width: 560px; max-width: 90vw;
  }
  .awaiter h3 { margin: 0 0 6px; color: var(--accent); }
  .awaiter p.prompt { color: var(--muted); margin: 0 0 16px; }
  .awaiter .btns { display: flex; gap: 10px; }
  .awaiter button {
    padding: 8px 16px; border-radius: 5px; border: 1px solid var(--border);
    background: var(--panel-hi); color: var(--fg); cursor: pointer; font-size: 13px;
  }
  .awaiter button.ok { border-color: var(--ok); color: var(--ok); }
  .awaiter button.no { border-color: var(--danger); color: var(--danger); }
  .awaiter button.revise { border-color: var(--accent); color: var(--accent); }
  .awaiter textarea {
    width: 100%; min-height: 100px; margin-top: 12px; padding: 8px; border-radius: 5px;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    font: inherit; font-size: 13px;
  }
  .awaiter .send { margin-top: 10px; align-self: flex-end; }
  .bm-badge {
    position: fixed; top: 8px; right: 12px; color: var(--danger);
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
  }
</style>
<script type="importmap">
{ "imports": {
  "preact": "https://esm.sh/preact@10.25.4",
  "preact/hooks": "https://esm.sh/preact@10.25.4/hooks",
  "htm": "https://esm.sh/htm@3.1.1",
  "htm/preact": "https://esm.sh/htm@3.1.1/preact"
} }
</script>
</head>
<body>
<div id="root"></div>
<script type="module">
import { h, render } from "preact";
import { useEffect, useState, useCallback } from "preact/hooks";
import { html } from "htm/preact";

const TOKEN = ${jsonToken};
const api = (p) => p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(TOKEN);

async function jget(p) {
  const r = await fetch(api(p));
  if (!r.ok) throw new Error("GET " + p + " → " + r.status);
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(api(p), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("POST " + p + " → " + r.status);
  return r.json();
}

function App() {
  const [reports, setReports] = useState([]);
  const [awaiters, setAwaiters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [benchmark, setBenchmark] = useState(false);

  const refreshState = useCallback(async () => {
    const s = await jget("/api/state");
    setReports(s.reports);
    setAwaiters(s.awaiters);
    setBenchmark(!!s.benchmarkMode);
  }, []);

  useEffect(() => {
    refreshState().catch(console.error);
    const onVis = () => { if (document.visibilityState === "visible") refreshState().catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    const ws = new WebSocket(\`ws://\${location.host}/ws?t=\${encodeURIComponent(TOKEN)}\`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "report:new" || msg.type === "report:update") {
          setReports((xs) => {
            const rest = xs.filter((r) => r.id !== msg.report.id);
            return [msg.report, ...rest].sort((a, b) => b.mtimeMs - a.mtimeMs);
          });
        } else if (msg.type === "awaiter:new") {
          setAwaiters((xs) => [...xs.filter(a => a.actionId !== msg.awaiter.actionId), msg.awaiter]);
        } else if (msg.type === "awaiter:resolved") {
          setAwaiters((xs) => xs.filter((a) => a.actionId !== msg.actionId));
        }
      } catch (e) { console.error(e); }
    };
    ws.onerror = (e) => console.error("ws error", e);
    return () => { document.removeEventListener("visibilitychange", onVis); try { ws.close(); } catch {} };
  }, [refreshState]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    jget("/api/report/" + encodeURIComponent(selected)).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const submitFeedback = useCallback(async (actionId, kind, text) => {
    try {
      await jpost("/api/feedback/" + encodeURIComponent(actionId), { kind, text });
    } catch (e) { alert("feedback failed: " + e.message); }
  }, []);

  const top = awaiters[0];

  return html\`
    <aside>
      <h1>REPORTS \${benchmark && html\`<span class="bm">benchmark-mode</span>\`}</h1>
      \${reports.length === 0 && html\`<div class="rli"><div class="m">no reports yet — run a sub-agent that calls mcp__sagol__write_report</div></div>\`}
      \${reports.map((r) => html\`
        <div class=\${"rli" + (r.id === selected ? " sel" : "")} onClick=\${() => setSelected(r.id)}>
          <div class="t">\${r.title}</div>
          <div class="m">\${r.source || ""} · \${r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}</div>
        </div>
      \`)}
    </aside>
    <main>
      \${!detail && html\`<div class="empty">select a report on the left</div>\`}
      \${detail && html\`
        <div class="body">
          <div class="fm">
            <span class="title">\${detail.frontmatter.title}</span>
            <div>id: \${detail.id} · source: \${detail.frontmatter.source || "—"} · body length: \${detail.bodyLen} chars</div>
            <div>timestamp: \${detail.frontmatter.timestamp || "—"}</div>
          </div>
          <div dangerouslySetInnerHTML=\${{ __html: detail.html }}></div>
        </div>
      \`}
    </main>
    \${top && html\`<\${AwaiterModal} awaiter=\${top} onSubmit=\${submitFeedback} />\`}
    \${benchmark && html\`<div class="bm-badge">benchmark mode</div>\`}
  \`;
}

function AwaiterModal({ awaiter, onSubmit }) {
  const [mode, setMode] = useState(null);
  const [text, setText] = useState("");
  return html\`
    <div class="awaiter-backdrop">
      <div class="awaiter">
        <h3>feedback requested</h3>
        <p class="prompt">report: \${awaiter.reportId}\${awaiter.prompt ? " — " + awaiter.prompt : ""}</p>
        \${mode === null && html\`
          <div class="btns">
            <button class="ok" onClick=\${() => onSubmit(awaiter.actionId, "approve")}>✓ approve</button>
            <button class="no" onClick=\${() => onSubmit(awaiter.actionId, "reject")}>✗ reject</button>
            <button class="revise" onClick=\${() => setMode("revise")}>✎ revise</button>
          </div>
        \`}
        \${mode === "revise" && html\`
          <div>
            <textarea value=\${text} onInput=\${(e) => setText(e.target.value)} placeholder="what should the agent do differently?"></textarea>
            <div class="btns" style="margin-top: 10px;">
              <button class="ok send" onClick=\${() => onSubmit(awaiter.actionId, "revise", text)}>send revision</button>
              <button onClick=\${() => setMode(null)}>cancel</button>
            </div>
          </div>
        \`}
      </div>
    </div>
  \`;
}

render(h(App, {}), document.getElementById("root"));
</script>
</body>
</html>`;
}
