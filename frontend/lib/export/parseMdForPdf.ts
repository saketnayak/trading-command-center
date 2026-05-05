export type MdSegment =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

export function parseMdForPdf(md: string): MdSegment[] {
  return md.split("\n").map((raw): MdSegment => {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) return { kind: "h3", text: line.slice(4) };
    if (line.startsWith("## ")) return { kind: "h2", text: line.slice(3) };
    if (line.startsWith("# ")) return { kind: "h1", text: line.slice(2) };
    if (line.startsWith("- ") || line.startsWith("* "))
      return { kind: "bullet", text: line.slice(2) };
    if (line.trim() === "") return { kind: "blank" };
    return { kind: "paragraph", text: line };
  });
}
