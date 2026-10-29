import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdownToHtml, formatMarkdownInline } from "../src/markdown.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "latin1").replace(/\r/g, "");

test("markdown renderer handles links, nested and numbered lists, and code spans", () => {
  assert.equal(
    formatMarkdownInline("[x](https://example.com/a?b=1&c=2)"),
    '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>'
  );
  assert.equal(formatMarkdownInline("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  assert.equal(formatMarkdownInline('`2*"B"` and *it*'), "<code>2*&quot;B&quot;</code> and <em>it</em>");

  const html = renderMarkdownToHtml("* a\n  * b\n  * c\n* d\n\n1. one\n2. two\n\ntext");
  assert.equal(
    html,
    "<ul>\n<li>\na\n<ul>\n<li>\nb\n</li>\n<li>\nc\n</li></ul>\n</li>\n<li>\nd\n</li></ul>\n<ol>\n<li>\none\n</li>\n<li>\ntwo\n</li></ol>\n<p>text</p>"
  );
});

test("NARRATIVE.md renders cleanly for the overlay", () => {
  const md = read("NARRATIVE.md");
  const html = renderMarkdownToHtml(md);
  assert.ok(!md.includes("\u2014"), "no em-dashes");
  assert.ok(!/\]\(http/.test(html), "no raw markdown links left in HTML");
  assert.match(html, /href="https:\/\/github\.com\/MartinGalway\/C64_music"/);
  assert.match(html, /href="https:\/\/github\.com\/charlesroper\/C64_music"/);
  assert.ok(!/<p>\s*[*-] /.test(html), "no unparsed bullet paragraphs");
  assert.ok(!/\bC13\b|NARRATIFE/.test(md));
});

test("every quotation in NARRATIVE.md appears verbatim in Galway's sources", () => {
  const md = read("NARRATIVE.md");
  const sources = ["ocean_assembler_directives.txt", "wizball.asm", "gameover.asm"]
    .map(read)
    .join("\n")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'");
  const quotes = md
    .split("\n")
    .filter((l) => l.startsWith('> "'))
    .map((l) => l.slice(3, l.lastIndexOf('"')).replace(/\s+/g, " ").replace(/"/g, "'"));
  assert.ok(quotes.length >= 6);
  for (const q of quotes) {
    assert.ok(sources.includes(q), `quotation not found in sources: ${q}`);
  }
});

test("narrative facts match the source files", () => {
  const wiz = read("wizball.asm").split("\n");
  assert.match(wiz[607], /^DREFRESH\s+LDA #32/);
  assert.match(wiz[417], /^DREFCOLOUR\s+EQU 15/);
  assert.match(wiz[3772], /^refsp\s+EQU \$100/);
  assert.match(read("gameover.asm"), /refsp\s+EQU \$0040/);
  assert.match(read("arkanoid.asm"), /refsp\s+EQU \$080;.*100Hz P\.A\.L\./);
  const ram = read("rambload.asm").split("\n");
  assert.match(ram[1231], /^STARTMC/);
  assert.match(read("arkadrum.asm").split("\n")[137], /^HIHAT/);
});
