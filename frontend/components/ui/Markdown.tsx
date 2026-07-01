"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from 'remark-gfm';
import type { Components } from "react-markdown";
import { normalizeMarkdown } from "@/lib/normalizeMarkdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-fg text-xl font-bold mt-5 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-fg text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-fg text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-fg-secondary text-sm leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-fg font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-fg-secondary italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-4 mb-3 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-4 mb-3 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-fg-secondary text-sm leading-relaxed">{children}</li>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse border border-neutral-300">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-neutral-300 px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-neutral-300 px-3 py-2">
      {children}
    </td>
  ),
  hr: () => <hr className="border-input-border my-4" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-input-border pl-3 my-3 text-muted italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    return isBlock ? (
      <pre className="bg-page rounded-sm p-3 overflow-x-auto mb-3">
        <code className="text-fg-secondary text-xs font-mono">{children}</code>
      </pre>
    ) : (
      <code className="bg-input text-fg-secondary text-xs font-mono px-1 py-0.5 rounded-sm">
        {children}
      </code>
    );
  },
};

interface Props {
  children: string;
}

export function Markdown({ children }: Props) {
  return (
    <div className="prose-report">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalizeMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
