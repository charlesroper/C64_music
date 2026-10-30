#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getTodayCalVer(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function computeNextVersion(currentVersion, date = new Date()) {
  const today = getTodayCalVer(date);
  if (!currentVersion || !currentVersion.startsWith(today)) {
    return today;
  }
  const match = currentVersion.match(new RegExp(`^${today.replace(/\./g, "\\.")}(?:\\.([0-9]+))?$`));
  if (!match) {
    return today;
  }
  const micro = match[1] !== undefined ? parseInt(match[1], 10) + 1 : 1;
  return `${today}.${micro}`;
}

export function applyVersion(nextVersion) {
  // 1. package.json
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const prevVersion = pkg.version;
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // 2. index.html
  const htmlPath = path.join(ROOT, "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace(
    /<title>Galway 64 \/\/ Ocean 6502-SID Workbench \(1985-1987\) v[^<]*<\/title>/,
    `<title>Galway 64 // Ocean 6502-SID Workbench (1985-1987) v${nextVersion}</title>`
  );
  html = html.replace(
    /<span class="brand-version" id="app-version">v[^<]*<\/span>/,
    `<span class="brand-version" id="app-version">v${nextVersion}</span>`
  );
  html = html.replace(
    /href="\.\/src\/styles\.css(?:\?v=[^"]*)?"/,
    `href="./src/styles.css?v=${nextVersion}"`
  );
  html = html.replace(
    /src="\.\/src\/app\.js(?:\?v=[^"]*)?"/,
    `src="./src/app.js?v=${nextVersion}"`
  );
  fs.writeFileSync(htmlPath, html, "utf8");

  // 3. src/version.js
  const verPath = path.join(ROOT, "src/version.js");
  fs.writeFileSync(verPath, `export const APP_VERSION = "${nextVersion}";\n`, "utf8");

  return { prevVersion, nextVersion };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const custom = process.argv[2];
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const next = custom && !custom.startsWith("-") ? custom : computeNextVersion(pkg.version);
  const { prevVersion, nextVersion } = applyVersion(next);
  console.log(`Bumped version: ${prevVersion} -> ${nextVersion}`);
}
