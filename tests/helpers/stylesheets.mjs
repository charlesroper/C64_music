import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Extract local stylesheet <link> entries from an HTML document in cascade order. */
export function extractStylesheetLinks(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const links = [];
  for (const match of withoutComments.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    const relMatch = attrs.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const relValue = (relMatch?.[1] ?? relMatch?.[2] ?? "").trim().toLowerCase();
    const relTokens = relValue.split(/\s+/).filter(Boolean);
    if (!relTokens.includes("stylesheet")) continue;

    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? "").trim();
    if (!href || /^(?:https?:)?\/\//i.test(href)) continue;

    const [withoutHash] = href.split("#");
    const [assetPath, query = ""] = withoutHash.split("?");
    const versionMatch = query.match(/(?:^|&)v=([^&]+)/);
    links.push({
      href,
      path: assetPath,
      version: versionMatch ? decodeURIComponent(versionMatch[1]) : null,
    });
  }
  return links;
}

/** Read all local stylesheets linked from an entry HTML document in cascade order. */
export function loadLinkedStylesheets({ htmlPath = path.join(ROOT, "index.html") } = {}) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const links = extractStylesheetLinks(html);
  if (links.length === 0) {
    throw new Error(`No stylesheet <link> tags found in ${htmlPath}`);
  }

  const baseDir = path.dirname(htmlPath);
  const cssParts = links.map((link) => {
    const filePath = path.resolve(baseDir, link.path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing linked stylesheet "${link.path}" at ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8");
  });

  return {
    html,
    links,
    cssText: cssParts.join("\n"),
  };
}

function advancePastString(src, index) {
  const quote = src[index];
  let i = index + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function findTopLevelDelimiter(src, start) {
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = advancePastString(src, i);
      continue;
    }
    if (ch === ";" || ch === "{") return { index: i, char: ch };
    i += 1;
  }
  return null;
}

function findMatchingBrace(src, openBrace) {
  let depth = 1;
  let i = openBrace + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = advancePastString(src, i);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return i;
}

function splitDeclarations(body) {
  const statements = [];
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      i = advancePastString(body, i);
      continue;
    }
    if (ch === ";") {
      statements.push(body.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  if (start < body.length) statements.push(body.slice(start));
  return statements;
}

function createLayerNode() {
  return { order: [], children: new Map() };
}

function registerLayerPath(root, segments) {
  let node = root;
  for (const segment of segments) {
    if (!node.children.has(segment)) {
      node.order.push(segment);
      node.children.set(segment, createLayerNode());
    }
    node = node.children.get(segment);
  }
}

function compareLayerPaths(root, a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let node = root;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i += 1) {
    if (a[i] !== b[i]) {
      return node.order.indexOf(a[i]) - node.order.indexOf(b[i]);
    }
    node = node.children.get(a[i]);
  }
  return b.length - a.length;
}

/**
 * Parse CSS into cascade-ordered rules with @layer and @media metadata.
 * Unlayered rules sort after layered rules, matching CSS Cascade Level 5.
 */
export function parseStylesheet(cssText) {
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const layerTree = createLayerNode();
  const rawRules = [];
  let anonCounter = 0;
  let orderCounter = 0;

  function toLayerSegments(rawName, parentPath) {
    const parts = rawName
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    return [...(parentPath ?? []), ...parts];
  }

  function parseBlocks(src, mediaQuery = null, layerPath = null) {
    let i = 0;
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (i >= src.length) break;

      const delim = findTopLevelDelimiter(src, i);
      if (!delim) break;

      if (delim.char === ";") {
        const stmt = src.slice(i, delim.index).trim();
        if (/^@layer\b/i.test(stmt)) {
          const names = stmt
            .replace(/^@layer\b/i, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const name of names) {
            registerLayerPath(layerTree, toLayerSegments(name, layerPath));
          }
        }
        i = delim.index + 1;
        continue;
      }

      const header = src.slice(i, delim.index).trim();
      const end = findMatchingBrace(src, delim.index);
      const body = src.slice(delim.index + 1, end - 1);

      if (/^@media\b/i.test(header)) {
        const cond = header.replace(/^@media\s+/i, "").trim();
        const nextMedia = mediaQuery
          ? mediaQuery
              .split(",")
              .flatMap((outer) =>
                cond.split(",").map((inner) => `${outer.trim()} and ${inner.trim()}`),
              )
              .join(", ")
          : cond;
        parseBlocks(body, nextMedia, layerPath);
      } else if (/^@layer\b/i.test(header)) {
        const rawName = header.replace(/^@layer\b/i, "").trim();
        const nextLayer = rawName
          ? toLayerSegments(rawName, layerPath)
          : [...(layerPath ?? []), `__anon_${anonCounter++}`];
        registerLayerPath(layerTree, nextLayer);
        parseBlocks(body, mediaQuery, nextLayer);
      } else if (!header.startsWith("@")) {
        const decls = {};
        for (const stmt of splitDeclarations(body)) {
          const colon = stmt.indexOf(":");
          if (colon === -1) continue;
          const rawProp = stmt.slice(0, colon).trim();
          const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
          const val = stmt
            .slice(colon + 1)
            .replace(/!important/gi, "")
            .trim();
          if (prop) decls[prop] = val;
        }
        for (const rawSel of header.split(",")) {
          const sel = rawSel.trim();
          if (sel) {
            rawRules.push({
              selector: sel,
              mediaQuery,
              layer: layerPath ? layerPath.join(".") : null,
              layerPath,
              order: orderCounter++,
              decls,
            });
          }
        }
      }

      i = end;
    }
  }

  parseBlocks(clean, null, null);
  rawRules.sort(
    (a, b) => compareLayerPaths(layerTree, a.layerPath, b.layerPath) || a.order - b.order,
  );
  return rawRules.map(({ selector, mediaQuery, layer, decls }) => ({
    selector,
    mediaQuery,
    layer,
    decls,
  }));
}

function matchesMediaBranch(branch, { width, height }) {
  for (const m of branch.matchAll(/\(max-width:\s*(\d+)px\)/g)) {
    if (!(width <= Number(m[1]))) return false;
  }
  for (const m of branch.matchAll(/\(min-width:\s*(\d+)px\)/g)) {
    if (!(width >= Number(m[1]))) return false;
  }
  for (const m of branch.matchAll(/\(max-height:\s*(\d+)px\)/g)) {
    if (!(height <= Number(m[1]))) return false;
  }
  for (const m of branch.matchAll(/\(min-height:\s*(\d+)px\)/g)) {
    if (!(height >= Number(m[1]))) return false;
  }
  return true;
}

export function matchesMedia(mediaQuery, viewport) {
  if (!mediaQuery) return true;
  return mediaQuery.split(",").some((branch) => matchesMediaBranch(branch, viewport));
}

/** Exact selector string match (does not intersect compound class/attribute rules). */
export function computeStyleForExactSelectors(rules, targetSelectors, viewport) {
  const selectorSet = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  const computed = {};
  for (const rule of rules) {
    if (!matchesMedia(rule.mediaQuery, viewport)) continue;
    if (selectorSet.has(rule.selector)) {
      for (const [k, v] of Object.entries(rule.decls)) {
        if (k === "overflow") {
          computed.overflow = v;
          computed["overflow-x"] = v;
          computed["overflow-y"] = v;
        } else {
          computed[k] = v;
        }
      }
    }
  }
  return computed;
}
