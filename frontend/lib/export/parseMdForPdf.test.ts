import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMdForPdf } from "./parseMdForPdf";

test("parses h1", () => {
  const result = parseMdForPdf("# Title");
  assert.deepEqual(result, [{ kind: "h1", text: "Title" }]);
});

test("parses h2", () => {
  const result = parseMdForPdf("## Section");
  assert.deepEqual(result, [{ kind: "h2", text: "Section" }]);
});

test("parses h3", () => {
  const result = parseMdForPdf("### Sub");
  assert.deepEqual(result, [{ kind: "h3", text: "Sub" }]);
});

test("parses bullet with dash", () => {
  const result = parseMdForPdf("- item one");
  assert.deepEqual(result, [{ kind: "bullet", text: "item one" }]);
});

test("parses bullet with asterisk", () => {
  const result = parseMdForPdf("* item two");
  assert.deepEqual(result, [{ kind: "bullet", text: "item two" }]);
});

test("parses blank line", () => {
  const result = parseMdForPdf("");
  assert.deepEqual(result, [{ kind: "blank" }]);
});

test("parses paragraph", () => {
  const result = parseMdForPdf("Some plain text.");
  assert.deepEqual(result, [{ kind: "paragraph", text: "Some plain text." }]);
});

test("strips trailing whitespace from lines", () => {
  const result = parseMdForPdf("hello   ");
  assert.deepEqual(result, [{ kind: "paragraph", text: "hello" }]);
});

test("parses multi-line input", () => {
  const input = "# H1\n\nParagraph.\n- Bullet";
  const result = parseMdForPdf(input);
  assert.deepEqual(result, [
    { kind: "h1", text: "H1" },
    { kind: "blank" },
    { kind: "paragraph", text: "Paragraph." },
    { kind: "bullet", text: "Bullet" },
  ]);
});
