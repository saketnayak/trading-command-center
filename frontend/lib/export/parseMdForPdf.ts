// npm install unified remark-parse remark-gfm
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export type MdSegment =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string; spans: InlineSpan[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "blank" };

type InlineSpan = { 
  text: string; 
  bold?: boolean; 
  italic?: boolean; 
  code?: boolean 
};

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
};

function textFromNode(node: MdNode | undefined): string {
  if (!node) return "";

  if (typeof node.value === "string") {
    return node.value;
  }

  if (!node.children?.length) {
    return "";
  }

  return node.children.map(textFromNode).join("");
}

function paragraphFromNode(node: MdNode): string {
  return textFromNode(node).trim();
}

function listItemText(node: MdNode): string {
  if (!node.children?.length) return "";

  return node.children
    .map((child) => {
      if (child.type === "paragraph") return paragraphFromNode(child);
      return textFromNode(child);
    })
    .join(" ")
    .trim();
}

function tableRowsFromNode(node: MdNode): string[][] {
  if (!node.children?.length) return [];

  return node.children.map((row) => {
    if (!row.children?.length) return [];

    return row.children.map((cell) => textFromNode(cell).trim());
  });
}

export function parseMdForPdf(md: string): MdSegment[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(md) as MdNode;

  const segments: MdSegment[] = [];

  for (const node of tree.children?? []) {
    if (node.type === "heading") {
      const text = paragraphFromNode(node);

      if (node.depth === 1) {
        segments.push({ kind: "h1", text });
      } else if (node.depth === 2) {
        segments.push({ kind: "h2", text });
      } else {
        segments.push({ kind: "h3", text });
      }

      continue;
    }

    if (node.type === "paragraph") {
      const text = paragraphFromNode(node);
      if (text) {
        segments.push({ kind: "paragraph", text, spans: [] });
      }
      continue;
    }

    if (node.type === "list") {
      for (const item of node.children?? []) {
        const text = listItemText(item);
        if (text) {
          segments.push({ kind: "bullet", text });
        }
      }
      continue;
    }

    if (node.type === "table") {
      const rows = tableRowsFromNode(node);
      if (rows.length > 0) {
        segments.push({ kind: "table", rows: rows });
      }
      continue;
    }

    if (node.type === "code") {
      segments.push({ kind: "code", text: "```" + textFromNode(node).trim() + "```" });
      continue;
    }

    if (node.type === "thematicBreak") {
      segments.push({ kind: "blank" });
      continue;
    }

    if (node.type === "html") {
      const text = textFromNode(node).trim();
      if (text) {
        segments.push({ kind: "paragraph", text, spans: [] });
      }
      continue;
    }
  }

  return segments;
}
