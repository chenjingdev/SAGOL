/**
 * SAGOL dashboard — markdown compiler.
 *
 * Direct lift from caveman-report src/compiler.js with:
 *   - TypeScript port
 *   - REQUIRED_H2_COUNTS validation dropped (CAP-05: SAGOL has no taxonomy)
 *   - Frontmatter id check preserved (server.ts writes id/title/source/
 *     timestamp/summary and the dashboard assumes they're present)
 *
 * Part of the ≤200 LOC Phase 2 caveman-lift budget (DASH-05).
 */
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

function highlight(str: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre class="hljs"><code>${
        hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      }</code></pre>`;
    } catch {
      /* fall through */
    }
  }
  return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
}

const md = new MarkdownIt({ html: true, linkify: true, highlight });

export type ReportFrontmatter = {
  id: string;
  title: string;
  source?: string;
  timestamp?: string;
  summary?: string;
};

export type ParsedReport = {
  frontmatter: ReportFrontmatter;
  body: string;
  html: string;
};

export function parseAndCompile(mdContent: string): ParsedReport {
  const { data, content } = matter(mdContent);
  if (!data || typeof data !== "object" || !("id" in data) || !data.id) {
    throw new Error(`sagol dash: report markdown missing frontmatter id`);
  }
  const frontmatter: ReportFrontmatter = {
    id: String(data.id),
    title: String(data.title ?? "(untitled)"),
    source: data.source == null ? undefined : String(data.source),
    timestamp: data.timestamp == null ? undefined : String(data.timestamp),
    summary: data.summary == null ? undefined : String(data.summary),
  };
  const html = md.render(content);
  return { frontmatter, body: content, html };
}

export function renderInline(markdown: string): string {
  return md.renderInline(markdown);
}
