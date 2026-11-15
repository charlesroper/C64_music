import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright-core";

const ENGINE_MODULES = { chromium, firefox, webkit };
export const ENGINE_NAMES = Object.keys(ENGINE_MODULES);
const PREFERRED_CHROMIUM = "chromium_headless_shell-1243";
const PATH_OVERRIDES = {
  chromium: "CHROME_PATH",
  firefox: "FIREFOX_PATH",
  webkit: "WEBKIT_PATH",
};

export function defaultBrowserCache(env = process.env) {
  return env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");
}

function isExecutableFile(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findChromium153(cacheDir) {
  const root = path.join(cacheDir, PREFERRED_CHROMIUM);
  if (!existsSync(root)) return null;
  for (const child of readdirSync(root, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
      const candidate = path.join(root, child.name, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function findSystemChromium(env) {
  const searchPath = env.PATH ?? process.env.PATH ?? "";
  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    for (const directory of searchPath.split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, command);
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  return null;
}

function cacheEntryFor(file, cacheDir) {
  const relative = path.relative(cacheDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0] || null;
}

function revisionFor(entry) {
  const match = entry?.match(/-(\d+)$/);
  return match ? match[1] : null;
}

function engineExecutables(options) {
  return Object.fromEntries(
    ENGINE_NAMES.map((name) => [
      name,
      options.executables?.[name] ?? ENGINE_MODULES[name].executablePath(),
    ]),
  );
}

function engineResult({ name, path: executable, source, cacheEntry, warning }) {
  return {
    name,
    path: executable,
    source,
    revision: revisionFor(cacheEntry),
    cacheEntry,
    warning,
  };
}

function chromiumFallbackWarning(source) {
  return `Chromium 153 headless shell not found. Using ${source}; revisions 156 and later crash under PRoot.`;
}

export function resolveBrowserEngine(name, options = {}) {
  if (!ENGINE_NAMES.includes(name)) {
    throw new Error(`Unknown browser engine "${name}". Choose chromium, firefox or webkit.`);
  }
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? defaultBrowserCache(env);
  const executables = engineExecutables(options);

  const override = env[PATH_OVERRIDES[name]];
  if (override) {
    if (!isExecutableFile(override)) {
      throw new Error(`${name} path from ${PATH_OVERRIDES[name]} is not executable: ${override}`);
    }
    return engineResult({
      name,
      path: override,
      source: "env",
      cacheEntry: cacheEntryFor(override, cacheDir),
    });
  }

  if (name === "chromium") {
    const preferred = findChromium153(cacheDir);
    if (preferred) {
      return engineResult({
        name,
        path: preferred,
        source: "cache",
        cacheEntry: PREFERRED_CHROMIUM,
      });
    }
  }

  const executable = executables[name];
  if (isExecutableFile(executable)) {
    return engineResult({
      name,
      path: executable,
      source: "playwright",
      cacheEntry: cacheEntryFor(executable, cacheDir),
      warning: name === "chromium" ? chromiumFallbackWarning("the Playwright Chromium") : undefined,
    });
  }

  if (name === "chromium") {
    const system = findSystemChromium(env);
    if (system) {
      return engineResult({
        name,
        path: system,
        source: "system",
        cacheEntry: null,
        warning: chromiumFallbackWarning("a system Chromium"),
      });
    }
    throw new Error(
      `Chromium 153 headless shell not found. Run npx playwright@1.63.0 install chromium-headless-shell, or set CHROME_PATH.`,
    );
  }

  const expectedRevision = playwrightBrowserRevision(name);
  const expected = expectedRevision ? ` (expected revision ${expectedRevision})` : "";
  throw new Error(
    `${name} was not found${expected}. Run npx playwright-core install ${name}, or set ${PATH_OVERRIDES[name]}.`,
  );
}

const BROWSER_ENTRY =
  /^(chromium|chromium_headless_shell|firefox|webkit|ffmpeg|winldd|android)-\d+$/;

const require = createRequire(import.meta.url);

function playwrightBrowserRevision(name) {
  try {
    const packageFile = require.resolve("playwright-core/package.json");
    const browsers = JSON.parse(
      readFileSync(path.join(path.dirname(packageFile), "browsers.json"), "utf8"),
    );
    return browsers.browsers.find((browser) => browser.name === name)?.revision ?? null;
  } catch {
    return null;
  }
}

function playwrightFfmpegEntry() {
  const revision = playwrightBrowserRevision("ffmpeg");
  return revision ? `ffmpeg-${revision}` : null;
}

export function keepEntriesForHost(options = {}) {
  const cacheDir = options.cacheDir ?? defaultBrowserCache(options.env);
  const keep = new Set();
  if (findChromium153(cacheDir)) keep.add(PREFERRED_CHROMIUM);
  for (const name of ENGINE_NAMES) {
    try {
      const resolved = resolveBrowserEngine(name, { ...options, cacheDir });
      if (resolved.cacheEntry) keep.add(resolved.cacheEntry);
    } catch {
      // A missing engine should not block cleanup of the other revisions.
    }
  }
  const ffmpeg = playwrightFfmpegEntry();
  if (ffmpeg && existsSync(path.join(cacheDir, ffmpeg))) keep.add(ffmpeg);
  return [...keep];
}

function directorySize(entry) {
  const stats = lstatSync(entry);
  if (stats.isSymbolicLink()) return 0;
  if (stats.isFile()) return stats.size;
  let total = 0;
  for (const child of readdirSync(entry)) {
    total += directorySize(path.join(entry, child));
  }
  return total;
}

export function planBrowserCleanup({
  cacheDir = defaultBrowserCache(),
  env = process.env,
  keep,
} = {}) {
  if (!existsSync(cacheDir)) {
    throw new Error(`Playwright browser cache not found: ${cacheDir}`);
  }
  const keepSet = new Set(keep ?? keepEntriesForHost({ cacheDir, env }));
  const plan = { cacheDir, keep: [], remove: [], skipped: [], keepBytes: 0, removeBytes: 0 };

  for (const child of readdirSync(cacheDir, { withFileTypes: true })) {
    const entry = path.join(cacheDir, child.name);
    if (lstatSync(entry).isSymbolicLink()) {
      plan.skipped.push({ name: child.name, reason: "symlink" });
      continue;
    }
    if (!child.isDirectory() || !BROWSER_ENTRY.test(child.name)) continue;
    const target = keepSet.has(child.name) ? plan.keep : plan.remove;
    const bytes = directorySize(entry);
    target.push({ name: child.name, bytes });
    if (target === plan.keep) plan.keepBytes += bytes;
    else plan.removeBytes += bytes;
  }

  return plan;
}
