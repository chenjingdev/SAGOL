/**
 * SAGOL dashboard — in-memory report + awaiter store. Lifted in spirit
 * from caveman-report src/context.js. Part of the caveman-lift budget
 * (DASH-05 + D-26).
 */
import { parseAndCompile, type ReportFrontmatter } from "./compiler.ts";

export type ReportEntry = {
  id: string;
  frontmatter: ReportFrontmatter;
  html: string;
  bodyLen: number;
  mtimeMs: number;
  path: string;
};
export type AwaiterFeedback = { kind: "approve" | "reject" | "revise"; text?: string };
export type Awaiter = {
  actionId: string;
  reportId: string;
  prompt?: string;
  createdAt: number;
  resolve: (f: AwaiterFeedback | null) => void;
  pending: Promise<AwaiterFeedback | null>;
};

export class DashContext {
  readonly reports = new Map<string, ReportEntry>();
  readonly awaiters = new Map<string, Awaiter>();
  readonly feedbackSeen = new Set<string>();

  upsertReport(path: string, md: string, mtimeMs: number): ReportEntry | null {
    try {
      const p = parseAndCompile(md);
      const entry: ReportEntry = {
        id: p.frontmatter.id,
        frontmatter: p.frontmatter,
        html: p.html,
        bodyLen: p.body.length,
        mtimeMs,
        path,
      };
      this.reports.set(entry.id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  listReports(): ReportEntry[] {
    return [...this.reports.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  registerAwaiter(actionId: string, reportId: string, prompt?: string): Awaiter {
    const existing = this.awaiters.get(actionId);
    if (existing) return existing;
    let resolve!: (f: AwaiterFeedback | null) => void;
    const pending = new Promise<AwaiterFeedback | null>((r) => { resolve = r; });
    const a: Awaiter = { actionId, reportId, prompt, createdAt: Date.now(), resolve, pending };
    this.awaiters.set(actionId, a);
    return a;
  }

  submitFeedback(actionId: string, f: AwaiterFeedback): "ok" | "duplicate" | "unknown" {
    if (this.feedbackSeen.has(actionId)) return "duplicate";
    const a = this.awaiters.get(actionId);
    if (!a) return "unknown";
    this.feedbackSeen.add(actionId);
    a.resolve(f);
    this.awaiters.delete(actionId);
    return "ok";
  }

  expireAwaiter(actionId: string): void {
    const a = this.awaiters.get(actionId);
    if (!a) return;
    a.resolve(null);
    this.awaiters.delete(actionId);
  }
}
