import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMdForPdf } from "./parseMdForPdf";

test("parses h1", () => {
  assert.deepEqual(parseMdForPdf("# Title"), [{ kind: "h1", text: "Title" }]);
});

test("parses h2", () => {
  assert.deepEqual(parseMdForPdf("## Section"), [{ kind: "h2", text: "Section" }]);
});

test("parses h3", () => {
  assert.deepEqual(parseMdForPdf("### Sub"), [{ kind: "h3", text: "Sub" }]);
});

test("parses bullet with dash", () => {
  assert.deepEqual(parseMdForPdf("- item one"), [{ kind: "bullet", text: "item one" }]);
});

test("parses bullet with asterisk", () => {
  assert.deepEqual(parseMdForPdf("* item two"), [{ kind: "bullet", text: "item two" }]);
});

test("parses blank line", () => {
  assert.deepEqual(parseMdForPdf(""), [{ kind: "blank" }]);
});

test("parses paragraph", () => {
  assert.deepEqual(parseMdForPdf("Some plain text."), [{ kind: "paragraph", text: "Some plain text." }]);
});

test("strips trailing whitespace", () => {
  assert.deepEqual(parseMdForPdf("hello   "), [{ kind: "paragraph", text: "hello" }]);
});

test("parses multi-line input", () => {
  assert.deepEqual(parseMdForPdf("# H1\n\nParagraph.\n- Bullet"), [
    { kind: "h1", text: "H1" },
    { kind: "blank" },
    { kind: "paragraph", text: "Paragraph." },
    { kind: "bullet", text: "Bullet" },
  ]);
});
