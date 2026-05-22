"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from 'remark-gfm';
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-slate-100 text-xl font-bold mt-5 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-slate-100 text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-slate-200 text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-slate-300 text-sm leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="text-slate-100 font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-slate-300 italic">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-4 mb-3 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-4 mb-3 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-slate-300 text-sm leading-relaxed">{children}</li>
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
  hr: () => <hr className="border-slate-700 my-4" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-600 pl-3 my-3 text-slate-400 italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    return isBlock ? (
      <pre className="bg-slate-900 rounded p-3 overflow-x-auto mb-3">
        <code className="text-slate-300 text-xs font-mono">{children}</code>
      </pre>
    ) : (
      <code className="bg-slate-800 text-slate-300 text-xs font-mono px-1 py-0.5 rounded">
        {children}
      </code>
    );
  },
};

interface Props {
  children: string;
}

export function Markdown({ children }: Props) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>;
}
