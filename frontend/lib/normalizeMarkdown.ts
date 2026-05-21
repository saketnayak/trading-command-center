import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";

/**
 * Normalize Markdown through a real Markdown AST.
 *
 * Handles:
 * - GFM tables
 * - table pipe escaping
 * - contextual Markdown escaping
 * - consistent bullet/list formatting
 * - consistent fenced code blocks
 *
 * Do not use this for HTML sanitization. This only normalizes Markdown syntax.
 */
export function normalizeMarkdown(input: string | null | undefined): string {
  const source = input ?? "";

  if (!source.trim()) return "";

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm, {
      tableCellPadding: true,
      tablePipeAlign: true,
    })
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
      listItemIndent: "one",
      rule: "-",
      ruleRepetition: 3,
      emphasis: "*",
      strong: "*",
    })
    .processSync(source);

  return String(file).trimEnd() + "\n";
}

/**
 * Normalize Markdown but preserve empty input as empty string.
 * Useful before passing content into PDF Markdown rendering.
 */
export function normalizeMarkdownBlock(input: string | null | undefined): string {
  const normalized = normalizeMarkdown(input);
  return normalized.trim();
}
