/**
 * SAGOL dashboard — .sagol/reports/ watcher using fs.watch, debounced.
 * Part of the caveman-lift budget (DASH-05 + D-26).
 */
import { watch, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { DashContext, ReportEntry } from "./context.ts";

type Callback = (e: { entry: ReportEntry; isNew: boolean }) => void;
const DEBOUNCE_MS = 100;

async function loadOne(ctx: DashContext, dir: string, name: string): Promise<ReportEntry | null> {
  if (!name.endsWith(".md")) return null;
  const full = join(dir, name);
  try {
    const [md, st] = await Promise.all([readFile(full, "utf8"), stat(full)]);
    return ctx.upsertReport(full, md, st.mtimeMs);
  } catch {
    return null;
  }
}

export async function scanInitial(ctx: DashContext, dir: string): Promise<ReportEntry[]> {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return []; }
  const names = await readdir(dir);
  const out: ReportEntry[] = [];
  for (const n of names) { const e = await loadOne(ctx, dir, n); if (e) out.push(e); }
  return out;
}

export async function startWatcher(
  ctx: DashContext,
  dir: string,
  onUpsert: Callback,
  signal?: AbortSignal,
): Promise<void> {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const flush = async (name: string) => {
    pending.delete(name);
    const before = ctx.reports.size;
    const entry = await loadOne(ctx, dir, name);
    if (entry) onUpsert({ entry, isNew: ctx.reports.size > before });
  };
  try {
    for await (const ev of watch(dir, { signal })) {
      const name = ev.filename;
      if (!name || !name.endsWith(".md")) continue;
      const t = pending.get(name);
      if (t) clearTimeout(t);
      pending.set(name, setTimeout(() => { void flush(name); }, DEBOUNCE_MS));
    }
  } catch (e) {
    if ((e as { name?: string }).name !== "AbortError") throw e;
  }
}
