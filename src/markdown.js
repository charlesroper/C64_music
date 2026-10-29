// Minimal markdown renderer for the in-app "The Story" overlay.
// Supports: headings (#, ##, ###), paragraphs, fenced code, blockquotes,
// horizontal rules, bullet and numbered lists with nesting by indentation,
// **bold**, *italic*, `code` and [text](https://url) links.

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMarkdownInline(str) {
  // Pull out code spans first so their contents are never reformatted.
  const codeSpans = [];
  let s = String(str).replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codeSpans[Number(i)])}</code>`);
}

const LIST_ITEM = /^(\s*)([*-]|\d+\.)\s+(.*)$/;

export function renderMarkdownToHtml(md) {
  if (!md) return "";
  const lines = md.split("\n");
  const out = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  // Stack of open lists: { indent, tag }
  let lists = [];

  const closeListsTo = (indent) => {
    while (lists.length && lists[lists.length - 1].indent > indent) {
      out.push(`</li></${lists.pop().tag}>`);
    }
  };
  const closeAllLists = () => closeListsTo(-1);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        closeAllLists();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = item[1].length;
      const tag = /^\d/.test(item[2]) ? "ol" : "ul";
      closeListsTo(indent);
      const top = lists[lists.length - 1];
      if (top && top.indent === indent) {
        out.push("</li>");
        out.push("<li>");
      } else {
        out.push(`<${tag}>`);
        out.push("<li>");
        lists.push({ indent, tag });
      }
      out.push(formatMarkdownInline(item[3]));
      continue;
    }

    // Indented continuation of a list item
    if (lists.length && /^\s+\S/.test(line)) {
      out.push(" " + formatMarkdownInline(line.trim()));
      continue;
    }

    closeAllLists();

    if (line.trim() === "") continue;
    if (line.trim() === "---") {
      out.push("<hr />");
    } else if (line.startsWith("### ")) {
      out.push(`<h3>${formatMarkdownInline(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      out.push(`<h2>${formatMarkdownInline(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      out.push(`<h1>${formatMarkdownInline(line.slice(2))}</h1>`);
    } else if (line.startsWith("> ")) {
      out.push(`<blockquote><p>${formatMarkdownInline(line.slice(2))}</p></blockquote>`);
    } else if (line === ">") {
      continue;
    } else {
      out.push(`<p>${formatMarkdownInline(line)}</p>`);
    }
  }

  closeAllLists();
  if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return out.join("\n");
}
