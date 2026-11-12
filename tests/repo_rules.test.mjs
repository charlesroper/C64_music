import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNextVersion } from "../scripts/bump_version.mjs";
import { deploy, verifyCleanTree, verifyRemote } from "../scripts/deploy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("computeNextVersion refuses to lower version when package.json holds a future date", () => {
  const mockDate = new Date("2026-10-30T12:00:00Z");
  assert.throws(
    () => computeNextVersion("2026.11.01", mockDate),
    /Refusing to lower version from future date 2026\.11\.01 to 2026\.10\.30/,
  );
  assert.throws(
    () => computeNextVersion("2026.11.01.3", mockDate),
    /Refusing to lower version from future date 2026\.11\.01\.3 to 2026\.10\.30/,
  );
});

test("deploy preflight aborts when working tree is dirty", () => {
  const fakeExec = (cmd) => {
    if (cmd === "git status --porcelain") {
      return " M scripts/deploy.mjs\n?? untracked.txt\n";
    }
    return "";
  };
  assert.throws(
    () => verifyCleanTree(fakeExec),
    /Working tree is dirty\. Commit or stash changes before deploying\./,
  );
  assert.throws(
    () => deploy({ exec: fakeExec, log: () => {} }),
    /Working tree is dirty\. Commit or stash changes before deploying\./,
  );
});

test("deploy preflight aborts when fork remote is missing", () => {
  const fakeExec = (cmd) => {
    if (cmd === "git status --porcelain") {
      return "";
    }
    if (cmd.startsWith("git remote get-url")) {
      throw new Error("fatal: No such remote 'fork'");
    }
    return "";
  };
  assert.throws(
    () => verifyRemote("fork", fakeExec),
    /Git remote "fork" is missing\. Add the remote before deploying\./,
  );
  assert.throws(
    () => deploy({ exec: fakeExec, log: () => {} }),
    /Git remote "fork" is missing\. Add the remote before deploying\./,
  );
});

test("deploy preflight executes preflight, lint, test, push, and reports pushed SHA", () => {
  const executed = [];
  const fakeExec = (cmd) => {
    executed.push(cmd);
    if (cmd === "git status --porcelain") return "";
    if (cmd === "git remote get-url fork") {
      return "git@github.com:charlesroper/C64_music.git\n";
    }
    if (cmd === "git rev-parse --short HEAD") return "58f4f4f\n";
    return "";
  };
  const logs = [];
  const result = deploy({
    exec: fakeExec,
    remote: "fork",
    branch: "main",
    log: (msg) => logs.push(msg),
  });

  assert.equal(result.commit, "58f4f4f");
  assert.deepEqual(executed, [
    "git status --porcelain",
    "git remote get-url fork",
    "npm run lint",
    "npm test",
    "npm run check:help-popovers",
    "git push fork main",
    "git rev-parse --short HEAD",
  ]);
  assert.ok(logs.some((l) => l.includes("Successfully pushed commit 58f4f4f to fork/main.")));

  const failingExec = (cmd) => {
    if (cmd === "git status --porcelain") return "";
    if (cmd === "git remote get-url fork") {
      return "git@github.com:charlesroper/C64_music.git\n";
    }
    if (cmd === "git push fork main") throw new Error("Connection refused");
    return "";
  };
  assert.throws(() => deploy({ exec: failingExec, log: () => {} }), /Connection refused/);
});

test("no em-dash (U+2014) characters exist in repository prose, markdown, or code", () => {
  const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.endsWith(".wasm") && !f.startsWith(".agents/"));

  const emDashChar = "\u2014";
  const violations = [];

  for (const relPath of trackedFiles) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes(emDashChar)) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (line.includes(emDashChar)) {
          violations.push(`${relPath}:${idx + 1}: ${line}`);
        }
      });
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found literal em-dashes (U+2014) in tracked files:\n${violations.join("\n")}`,
  );
});

test("historical Ocean assembly sources and assembler directives remain authentic and unmodified", () => {
  const EXPECTED_HASHES = {
    "wizball.asm": "b1510837750dcd05106be51ec71c50454c1d291293631e1b15de391b1c929dc7",
    "arkanoid.asm": "63d55459ad12a21ef179c98d6361381c883b1680dc997e33e5b924b991a59c67",
    "arkadrum.asm": "2ac184533d43e4935408d59d2ae7fb410cc6b9774039e1738841a3dbd69712cf",
    "gameover.asm": "21ab40e7a2e732adc088be5fbed4d2279345d07682182dccf999045eb2d10fbf",
    "greenberet.asm": "ce8d548ca3a03b4ff1bc5e10dba7fc002217cc4003f2a5d203e1c5b85371b6a2",
    "rambload.asm": "78e7927e6c2e8f7d42c18d2e02bec764a2911d2d8180cec789020bdd60cdbb75",
    "ocean_assembler_directives.txt":
      "e61fa3676fa515dd871c139502eaaa37593777174a7f06038735125be108c0ee",
  };

  for (const [file, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    const filePath = path.join(ROOT, file);
    assert.ok(fs.existsSync(filePath), `Historical source file missing: ${file}`);
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(
      hash,
      expectedHash,
      `Historical file ${file} has been modified or corrupted (expected SHA-256 ${expectedHash}, got ${hash})`,
    );
  }
});

test("NARRATIVE.md leaves no commit-hash placeholder", () => {
  const narrative = fs.readFileSync(path.join(ROOT, "NARRATIVE.md"), "utf8");
  assert.doesNotMatch(
    narrative,
    /\[HASH\]/,
    "Replace [HASH] with the short commit hash in a follow-up Record commit",
  );
});

test("documentation test counts in README.md and NARRATIVE.md match automated test suite", () => {
  const testsDir = path.join(ROOT, "tests");
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();

  let actualTestCount = 0;
  for (const file of testFiles) {
    const content = fs.readFileSync(path.join(testsDir, file), "utf8");
    const matches = content.match(/^\s*(?:await\s+)?test\(/gm);
    if (matches) {
      actualTestCount += matches.length;
    }
  }

  const numberWordMap = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
  };
  const expectedFileWord = numberWordMap[testFiles.length] || String(testFiles.length);

  // 1. README.md
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const readmeMatch = readme.match(
    /The test runner executes (\d+) automated checks across (\w+) test files:/,
  );
  assert.ok(readmeMatch, "README.md must state total test count and file count");
  assert.equal(
    parseInt(readmeMatch[1], 10),
    actualTestCount,
    `README.md test count (${readmeMatch[1]}) must match suite total (${actualTestCount})`,
  );
  assert.equal(
    readmeMatch[2].toLowerCase(),
    expectedFileWord,
    `README.md test file count (${readmeMatch[2]}) must match actual (${expectedFileWord})`,
  );

  // 2. NARRATIVE.md
  const narrative = fs.readFileSync(path.join(ROOT, "NARRATIVE.md"), "utf8");
  const narrativeMatch = narrative.match(
    /`npm test` runs (\d+) automated checks across (\w+) test files:/,
  );
  assert.ok(narrativeMatch, "NARRATIVE.md must state total test count and file count");
  assert.equal(
    parseInt(narrativeMatch[1], 10),
    actualTestCount,
    `NARRATIVE.md test count (${narrativeMatch[1]}) must match suite total (${actualTestCount})`,
  );
  assert.equal(
    narrativeMatch[2].toLowerCase(),
    expectedFileWord,
    `NARRATIVE.md test file count (${narrativeMatch[2]}) must match actual (${expectedFileWord})`,
  );
});

test("current documentation avoids retired Workbench View labels", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const narrative = fs.readFileSync(path.join(ROOT, "NARRATIVE.md"), "utf8");
  const blogStart = narrative.indexOf("## 8. Development blog");
  assert.ok(blogStart > -1, "NARRATIVE.md must keep the Section 8 heading");
  const narrativeCurrent = narrative.slice(0, blogStart);
  const retiredLabels = [
    "EDIT .ASM",
    "VIEW LIVE ASM",
    "LIVE .ASM",
    "OCEAN ASM DOCS",
    "C64 KEY INJECT",
    "HUD Row Guide",
    "CRT Scanlines",
    "Follow Voice",
    "Mobile Studio Panels",
    "About Audio Mode",
    "Close Audio Mode help",
    "4x FFWD",
  ];

  for (const [documentName, text] of [
    ["README.md", readme],
    ["NARRATIVE.md sections 1 to 7", narrativeCurrent],
  ]) {
    for (const label of retiredLabels) {
      assert.ok(
        !text.includes(label),
        `${documentName} must not use retired UI label "${label}". Describe the shipped label instead.`,
      );
    }
  }
});

test("AGENTS.md search guidance stays harness agnostic", () => {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const section = agents.match(/## 7\. Search tooling\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, "AGENTS.md must keep Section 7 Search tooling");

  const guidance = section[1];
  assert.match(
    guidance,
    /agent harness's built-in content search and file discovery tools/,
    "Search guidance must refer to the harness, not one named tool set",
  );
  assert.doesNotMatch(guidance, /OpenCode/, "Search guidance must not assume OpenCode");
  assert.doesNotMatch(
    guidance,
    /built-in `(?:grep|glob)`/,
    "Search guidance must not hardcode OpenCode built-in tool names",
  );
  assert.match(guidance, /shell `rg`/, "Search guidance must name the rg fallback");
  assert.match(guidance, /shell `fd`/, "Search guidance must name the fd fallback");
  assert.match(guidance, /fdfind/, "Search guidance must note the Debian fd binary name");
  assert.match(
    guidance,
    /Where RTK is wired, it rewrites shell commands, not built-in tools/,
    "Search guidance must not assume RTK is wired in every harness",
  );
});

test("calendar version is synchronized across package.json, package-lock.json, index.html, and src/version.js", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const verJs = fs.readFileSync(path.join(ROOT, "src/version.js"), "utf8");

  const calver = pkg.version;
  assert.match(
    calver,
    /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/,
    `package.json version "${calver}" must follow CalVer YYYY.MM.DD or YYYY.MM.DD.MICRO`,
  );

  assert.equal(lock.version, calver, "package-lock.json version must match package.json");
  if (lock.packages?.[""]) {
    assert.equal(
      lock.packages[""].version,
      calver,
      "package-lock.json root package version must match package.json",
    );
  }

  const verJsMatch = verJs.match(/export const APP_VERSION = "([^"]+)";/);
  assert.ok(verJsMatch, "src/version.js must export APP_VERSION");
  assert.equal(verJsMatch[1], calver, "src/version.js APP_VERSION must match package.json");

  const titleMatch = html.match(
    /<title>Galway 2664 \/\/ Ocean 6502-SID Workbench \(1985-1987\) v([^<]+)<\/title>/,
  );
  assert.ok(titleMatch, "index.html title must declare CalVer version");
  assert.equal(titleMatch[1], calver, "index.html title version must match package.json");

  const badgeMatch = html.match(/<span class="brand-version" id="app-version">v([^<]+)<\/span>/);
  assert.ok(badgeMatch, "index.html header badge must declare CalVer version");
  assert.equal(badgeMatch[1], calver, "index.html header badge version must match package.json");
});
