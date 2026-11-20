import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  keepEntriesForHost,
  planBrowserCleanup,
  resolveBrowserEngine,
} from "../scripts/browser_engines.mjs";

function makeCache(t) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-browsers-"));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
}

test("chromium resolves the installed 153 headless shell before the Playwright default", (t) => {
  const cacheDir = makeCache(t);
  const preferred = path.join(
    cacheDir,
    "chromium_headless_shell-1243",
    "chrome-headless-shell-linux-arm64",
    "chrome-headless-shell",
  );
  const fallback = path.join(cacheDir, "chromium-1254", "chrome-linux", "chrome");
  touch(preferred);
  touch(fallback);

  const resolved = resolveBrowserEngine("chromium", {
    cacheDir,
    env: {},
    executables: { chromium: fallback },
  });

  assert.equal(resolved.path, preferred);
  assert.equal(resolved.source, "cache");
  assert.equal(resolved.revision, "1243");
  assert.equal(resolved.cacheEntry, "chromium_headless_shell-1243");
  assert.equal(resolved.warning, undefined);
});

test("chromium warns when the 153 headless shell is missing and falls back", (t) => {
  const cacheDir = makeCache(t);
  const fallback = path.join(cacheDir, "chromium-1254", "chrome-linux", "chrome");
  touch(fallback);

  const resolved = resolveBrowserEngine("chromium", {
    cacheDir,
    env: {},
    executables: { chromium: fallback },
  });

  assert.equal(resolved.path, fallback);
  assert.equal(resolved.source, "playwright");
  assert.equal(resolved.revision, "1254");
  assert.match(resolved.warning, /Chromium 153/);
});

test("engine path overrides win over the Playwright registry", (t) => {
  const cacheDir = makeCache(t);
  const override = path.join(cacheDir, "firefox-1572", "firefox", "firefox");
  const fallback = path.join(cacheDir, "firefox-9999", "firefox", "firefox");
  touch(override);
  touch(fallback);

  const resolved = resolveBrowserEngine("firefox", {
    cacheDir,
    env: { FIREFOX_PATH: override },
    executables: { firefox: fallback },
  });

  assert.equal(resolved.path, override);
  assert.equal(resolved.source, "env");
  assert.equal(resolved.revision, "1572");
});

test("missing engine errors name the install command", (t) => {
  const cacheDir = makeCache(t);

  assert.throws(
    () =>
      resolveBrowserEngine("firefox", {
        cacheDir,
        env: {},
        executables: { firefox: path.join(cacheDir, "missing", "firefox") },
      }),
    /npx playwright-core install firefox/,
  );
  assert.throws(
    () =>
      resolveBrowserEngine("firefox", {
        cacheDir,
        env: {},
        executables: { firefox: path.join(cacheDir, "missing", "firefox") },
      }),
    /expected revision 1572/,
  );
});

test("CHROME_PATH overrides the cached Chromium", (t) => {
  const cacheDir = makeCache(t);
  const override = path.join(cacheDir, "custom", "chrome");
  touch(override);

  const resolved = resolveBrowserEngine("chromium", {
    cacheDir,
    env: { CHROME_PATH: override },
  });

  assert.equal(resolved.path, override);
  assert.equal(resolved.source, "env");
  assert.equal(resolved.cacheEntry, "custom");
  assert.equal(resolved.revision, null);
});

test("missing Chromium errors name the supported build", (t) => {
  const cacheDir = makeCache(t);

  assert.throws(
    () =>
      resolveBrowserEngine("chromium", {
        cacheDir,
        env: { PATH: "" },
        executables: { chromium: path.join(cacheDir, "missing", "chrome") },
      }),
    /Chromium 153 headless shell/,
  );
  assert.throws(
    () =>
      resolveBrowserEngine("chromium", {
        cacheDir,
        env: { PATH: "" },
        executables: { chromium: path.join(cacheDir, "missing", "chrome") },
      }),
    /npx playwright@1\.63\.0 install chromium-headless-shell/,
  );
});

test("cleanup plan keeps active revisions and removes stale browser builds", (t) => {
  const cacheDir = makeCache(t);
  const keep = ["chromium_headless_shell-1243", "firefox-1572", "webkit-2388", "ffmpeg-1013"];
  const stale = ["chromium_headless_shell-1187", "chromium-1223", "ffmpeg-1011"];
  for (const name of [...keep, ...stale]) touch(path.join(cacheDir, name, "binary"));
  touch(path.join(cacheDir, "notes", "readme.txt"));
  fs.symlinkSync(path.join(cacheDir, keep[0]), path.join(cacheDir, "webkit-9999"));

  const plan = planBrowserCleanup({ cacheDir, keep });

  assert.deepEqual(plan.keep.map((entry) => entry.name).sort(), [...keep].sort());
  assert.deepEqual(plan.remove.map((entry) => entry.name).sort(), [...stale].sort());
  assert.ok(plan.keepBytes > 0);
  assert.ok(plan.removeBytes > 0);
  assert.ok(plan.skipped.some((entry) => entry.name === "webkit-9999"));
  assert.ok(!plan.remove.some((entry) => entry.name === "notes"));
});

test("host keep set follows the resolved engines and existing ffmpeg", (t) => {
  const cacheDir = makeCache(t);
  touch(path.join(cacheDir, "chromium_headless_shell-1243", "shell", "chrome-headless-shell"));
  touch(path.join(cacheDir, "firefox-1572", "firefox", "firefox"));
  touch(path.join(cacheDir, "webkit-2388", "pw_run.sh"));
  touch(path.join(cacheDir, "ffmpeg-1013", "ffmpeg-linux"));

  const keep = keepEntriesForHost({
    cacheDir,
    env: {},
    executables: {
      firefox: path.join(cacheDir, "firefox-1572", "firefox", "firefox"),
      webkit: path.join(cacheDir, "webkit-2388", "pw_run.sh"),
    },
  });

  assert.ok(keep.includes("chromium_headless_shell-1243"));
  assert.ok(keep.includes("firefox-1572"));
  assert.ok(keep.includes("webkit-2388"));
  assert.ok(keep.some((entry) => entry.startsWith("ffmpeg-")));
});

test("chromium falls back to a system browser on PATH", (t) => {
  const cacheDir = makeCache(t);
  const binDir = path.join(cacheDir, "bin");
  const systemChrome = path.join(binDir, "chromium");
  touch(systemChrome);

  const resolved = resolveBrowserEngine("chromium", {
    cacheDir,
    env: { PATH: binDir },
    executables: { chromium: path.join(cacheDir, "missing", "chrome") },
  });

  assert.equal(resolved.path, systemChrome);
  assert.equal(resolved.source, "system");
  assert.equal(resolved.cacheEntry, null);
  assert.equal(resolved.revision, null);
});

test("browser check exits non-zero when an engine is missing", (t) => {
  const cacheDir = makeCache(t);
  const cli = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "browsers.mjs",
  );
  const result = spawnSync(process.execPath, [cli, "check"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "", PLAYWRIGHT_BROWSERS_PATH: cacheDir },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /MISSING/);
});

test("browser check reports ready engines from the configured cache", (t) => {
  const cacheDir = makeCache(t);
  const chromium = path.join(
    cacheDir,
    "chromium_headless_shell-1243",
    "shell",
    "chrome-headless-shell",
  );
  const firefox = path.join(cacheDir, "firefox-1572", "firefox", "firefox");
  const webkit = path.join(cacheDir, "webkit-2388", "pw_run.sh");
  touch(chromium);
  touch(firefox);
  touch(webkit);
  const cli = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "browsers.mjs",
  );
  const result = spawnSync(process.execPath, [cli, "check"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: "",
      PLAYWRIGHT_BROWSERS_PATH: cacheDir,
      FIREFOX_PATH: firefox,
      WEBKIT_PATH: webkit,
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /chromium\s+1243\s+cache\s+ok/);
  assert.match(result.stdout, /firefox\s+1572.*\sok/);
  assert.match(result.stdout, /webkit\s+2388.*\sok/);
});

test("clean command is a dry run until --yes", (t) => {
  const cacheDir = makeCache(t);
  const keepExecutable = path.join(cacheDir, "firefox-1572", "firefox", "firefox");
  touch(keepExecutable);
  touch(path.join(cacheDir, "firefox-9999", "firefox", "firefox"));
  const cli = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "browsers.mjs",
  );
  const env = {
    ...process.env,
    PATH: "",
    PLAYWRIGHT_BROWSERS_PATH: cacheDir,
    FIREFOX_PATH: keepExecutable,
  };

  const dryRun = spawnSync(process.execPath, [cli, "clean"], { encoding: "utf8", env });
  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /Dry run/);
  assert.ok(fs.existsSync(path.join(cacheDir, "firefox-9999")));

  const applied = spawnSync(process.execPath, [cli, "clean", "--yes"], { encoding: "utf8", env });
  assert.equal(applied.status, 0);
  assert.match(applied.stdout, /Removed 1/);
  assert.ok(!fs.existsSync(path.join(cacheDir, "firefox-9999")));
  assert.ok(fs.existsSync(path.join(cacheDir, "firefox-1572")));
});

test("browsers CLI rejects unknown flags and stays idle when imported", () => {
  const cli = path.resolve(import.meta.dirname, "..", "scripts", "browsers.mjs");
  const badFlag = spawnSync(process.execPath, [cli, "clean", "--yess"], { encoding: "utf8" });
  assert.equal(badFlag.status, 1);
  assert.match(badFlag.stderr, /--yess|Unknown option/i);

  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(`file://${cli}`)});`],
    { encoding: "utf8" },
  );
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});
