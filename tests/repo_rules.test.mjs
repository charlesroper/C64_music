import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNextVersion, updateHtmlVersion } from "../scripts/bump_version.mjs";
import {
  deploy,
  verifyCleanTree,
  verifyNarrativeCommitLinks,
  verifyRemote,
} from "../scripts/deploy.mjs";
import { installHooks, isVersionOnlyDiff } from "../scripts/install_hooks.mjs";
import { verifyDeploy } from "../scripts/verify_deploy.mjs";
import { addWorktree, linkWorktreeDependencies, removeWorktree } from "../scripts/worktree.mjs";
import { extractStylesheetLinks, parseStylesheet } from "./helpers/stylesheets.mjs";

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

test("updateHtmlVersion rewrites the title with the 1985-87 range and updates ?v= across all linked CSS stylesheets", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const updated = updateHtmlVersion(html, "2099.01.02");

  assert.match(
    updated,
    /<title>Galway 2664 \/\/ Ocean 6502-SID Workbench \(1985-87\) v2099\.01\.02<\/title>/,
  );
  assert.doesNotMatch(updated, /1985-1987/);

  const multiLinkHtml = [
    "<!doctype html><html><head>",
    "<title>Galway 2664 // Ocean 6502-SID Workbench (1985-87) v2026.11.16.3</title>",
    '<link rel="icon" href="./src/favicon.ico">',
    '<link rel="stylesheet" href="./src/styles/foundation.css?v=2026.11.16.3">',
    '<link href="./src/styles/overlays.css" rel="stylesheet">',
    "<link rel='stylesheet' href='./src/styles/c64-monitor.css?v=2026.11.16.3'>",
    "</head><body>",
    '<span class="customBadge" id="app-version">v2026.11.16.3</span>',
    '<script type="module" src="./src/main.js?v=2026.11.16.3"></script>',
    "</body></html>",
  ].join("\n");
  const multiUpdated = updateHtmlVersion(multiLinkHtml, "2099.01.02");
  assert.ok(
    multiUpdated.includes('<span class="customBadge" id="app-version">v2099.01.02</span>'),
    "updateHtmlVersion must match #app-version without hardcoding its CSS class",
  );
  const links = extractStylesheetLinks(multiUpdated);
  assert.deepEqual(
    links.map((link) => [link.path, link.version]),
    [
      ["./src/styles/foundation.css", "2099.01.02"],
      ["./src/styles/overlays.css", "2099.01.02"],
      ["./src/styles/c64-monitor.css", "2099.01.02"],
    ],
  );
  assert.ok(multiUpdated.includes('<link rel="icon" href="./src/favicon.ico">'));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-deploy-ok-"));
  const narrativePath = path.join(tmpDir, "NARRATIVE.md");
  fs.writeFileSync(
    narrativePath,
    [
      "## 8. Development blog",
      "",
      "### 16 November 2026: example change",
      "",
      "Commit [58f4f4f](https://github.com/charlesroper/C64_music/commit/58f4f4f) carries the change.",
    ].join("\n"),
  );
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
  try {
    const result = deploy({
      exec: fakeExec,
      remote: "fork",
      branch: "main",
      log: (msg) => logs.push(msg),
      narrativePath,
    });

    assert.equal(result.commit, "58f4f4f");
    assert.deepEqual(executed, [
      "git status --porcelain",
      "git remote get-url fork",
      "npm run check:lint",
      "npm test",
      "npm run check:help-popovers",
      "npm run check:layout",
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
    assert.throws(
      () => deploy({ exec: failingExec, log: () => {}, narrativePath }),
      /Connection refused/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deploy preflight aborts when latest NARRATIVE.md Section 8 entry lacks a commit link", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-deploy-narrative-"));
  const narrativePath = path.join(tmpDir, "NARRATIVE.md");
  try {
    fs.writeFileSync(
      narrativePath,
      [
        "## 8. Development blog",
        "",
        "### 16 November 2026: example change",
        "",
        "Body without a commit link.",
      ].join("\n"),
    );

    assert.throws(
      () => verifyNarrativeCommitLinks(narrativePath),
      /Latest NARRATIVE\.md Section 8 entry has no commit link/,
    );
    assert.throws(
      () =>
        deploy({
          exec: (cmd) => (cmd === "git status --porcelain" ? "" : "git@example.com:repo.git\n"),
          log: () => {},
          narrativePath,
        }),
      /Latest NARRATIVE\.md Section 8 entry has no commit link/,
    );

    fs.writeFileSync(
      narrativePath,
      [
        "## 8. Development blog",
        "",
        "### 16 November 2026: example change",
        "",
        "Commit [2e91223](https://github.com/charlesroper/C64_music/commit/2e91223) carries the change.",
      ].join("\n"),
    );
    assert.doesNotThrow(() => verifyNarrativeCommitLinks(narrativePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("no em-dash (U+2014) characters exist in repository prose, markdown, or code", () => {
  const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(
      (f) =>
        f.length > 0 && !f.endsWith(".wasm") && !f.endsWith(".m4a") && !f.startsWith(".agents/"),
    );

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
    "Replace [HASH] with the actual short commit hash before committing NARRATIVE.md",
  );
});

test("README.md documents every automated test file", () => {
  const testsDir = path.join(ROOT, "tests");
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  assert.ok(testFiles.length > 0, "tests/ must contain at least one test file");

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const file of testFiles) {
    assert.ok(
      readme.includes(`tests/${file}`),
      `README.md must document test file "tests/${file}"`,
    );
  }
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
    "RE-ASSEMBLE",
    "HOT-RELOADED OK",
    "Hot-reloaded OK",
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

test("README names the shipped workbench controls", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const start = readme.indexOf("## Workbench controls");
  assert.ok(start > -1, "README.md must keep a Workbench controls section");
  const end = readme.indexOf("\n## ", start + 3);
  const section = readme.slice(start, end === -1 ? undefined : end);
  const labels = [
    "**Previous track**",
    "**Play**",
    "**Pause**",
    "**Restart**",
    "**Next track**",
    "**Fast-forward 4x**",
    "**M**",
    "**S**",
    "**DIGI M**",
    "**Mute voice 1**",
    "**Mute voice 3**",
    "**Solo voice 1**",
    "**Solo voice 3**",
    "**Edit source**",
    "**View source**",
    "**Assemble and run**",
    "**Follow voice**",
    "**Jump to symbol or label**",
    "**Search source**",
    "**Ocean assembler docs**",
    "**SID chip**",
    "**Audio mode**",
    "**Playback**",
    "**Interactive**",
    "**Drum boost (`$D418`)**",
    "**HUD row guide**",
    "**CRT scanlines**",
    "**Inject C64 key**",
    "**All panels**",
    "**Monitor**",
    "**Tunes**",
    "**Source**",
  ];
  for (const label of labels) {
    assert.ok(
      section.includes(label),
      `README Workbench controls must name the shipped control "${label}".`,
    );
  }
});

function collectRetiredGlossaryTerms() {
  const glossary = fs.readFileSync(path.join(ROOT, "GLOSSARY.md"), "utf8");
  // Exclude canonical terms listed under another term's _Avoid_ and prose-ambiguous phrases.
  const canonicalTerms = new Set(
    Array.from(glossary.matchAll(/^\*\*([^*]+)\*\*:/gm), (match) => match[1].trim().toLowerCase()),
  );
  const allowInProse = new Set(["audio backend", "audio graph", "startup track"]);
  const retiredTerms = [];
  for (const match of glossary.matchAll(/^_Avoid_:\s*(.+)$/gm)) {
    for (const term of match[1].split(",").map((item) => item.trim())) {
      const lower = term.toLowerCase();
      if (!/\s/.test(term)) continue;
      if (canonicalTerms.has(lower) || allowInProse.has(lower)) continue;
      retiredTerms.push(term);
    }
  }
  return retiredTerms;
}

test("current documentation avoids retired domain terms", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const narrative = fs.readFileSync(path.join(ROOT, "NARRATIVE.md"), "utf8");
  const blogStart = narrative.indexOf("## 8. Development blog");
  assert.ok(blogStart > -1, "NARRATIVE.md must keep the Section 8 heading");
  const narrativeCurrent = narrative.slice(0, blogStart);

  const retiredTerms = collectRetiredGlossaryTerms();
  assert.ok(retiredTerms.length > 0, "GLOSSARY.md must declare multi-word _Avoid_ terms");

  for (const [documentName, text] of [
    ["README.md", readme],
    ["NARRATIVE.md sections 1 to 7", narrativeCurrent],
  ]) {
    for (const term of retiredTerms) {
      assert.ok(
        !text.toLowerCase().includes(term.toLowerCase()),
        `${documentName} must not use the GLOSSARY _Avoid_ term "${term}". Use the canonical term instead.`,
      );
    }
  }
});

test("hook installer writes an executable commit-msg hook enforcing Chris Beams rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-hooks-"));
  try {
    installHooks({ exec: () => dir, log: () => {} });
    const hook = path.join(dir, "commit-msg");
    assert.ok(fs.existsSync(hook), "installer must create commit-msg hook");
    assert.ok(fs.statSync(hook).mode & 0o111, "commit-msg hook must be executable");

    const checkMsg = (text) => {
      const msgFile = path.join(dir, "MSG");
      fs.writeFileSync(msgFile, text, "utf8");
      execFileSync(hook, [msgFile], { stdio: "pipe" });
    };

    checkMsg("Release 2026.11.16\n# Ignore comment lines\n");
    checkMsg("Fix pulse width jitter\n\nKeep footer columns aligned within 72 columns per line.\n");

    assert.throws(() => checkMsg("lowercase subject\n"), /capital letter/);
    assert.throws(() => checkMsg("Trailing period.\n"), /end with a period/);
    assert.throws(
      () => checkMsg("This commit subject exceeds fifty characters easily and should fail\n"),
      /exceeds 50 chars/,
    );
    assert.throws(() => checkMsg("Valid subject\nMissing blank line\n"), /blank line/);
    assert.throws(
      () =>
        checkMsg(
          "Valid subject\n\nThis body line deliberately exceeds seventy two characters in width right here.\n",
        ),
      /exceeds 72 chars/,
    );
    assert.throws(() => checkMsg("Valid subject \u2014 bad\n"), /em-dashes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lint runs through a script name that harness proxies leave alone", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["check:lint"],
    "biome check .",
    "package.json must expose the lint check as `check:lint`",
  );
  assert.ok(
    !("lint" in pkg.scripts),
    "Do not add a `lint` script. RTK rewrites `npm run lint` to `rtk lint`, which shells out to ESLint and fails on a Biome project.",
  );

  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/checks.yml"), "utf8");
  const deployScript = fs.readFileSync(path.join(ROOT, "scripts/deploy.mjs"), "utf8");
  assert.ok(
    workflow.includes("npm run check:lint"),
    "checks.yml must lint through `npm run check:lint`",
  );
  assert.ok(
    deployScript.includes("npm run check:lint"),
    "scripts/deploy.mjs must lint through `npm run check:lint`",
  );
});

test("hook installer writes an executable pre-commit hook with the safe lint script", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-hooks-"));
  try {
    const target = installHooks({ exec: () => dir, log: () => {} });
    assert.equal(target, path.join(dir, "pre-commit"), "installer must target the hooks directory");

    const content = fs.readFileSync(target, "utf8");
    assert.match(content, /^#!\/bin\/sh/, "hook must start with a POSIX shebang");
    assert.match(content, /npm run check:lint/, "hook must lint through check:lint");
    assert.doesNotMatch(content, /npm run lint/, "hook must not call the removed lint script");
    assert.match(
      content,
      /node --test \$TEST_FILES/,
      "hook must run only the staged test files for test-only commits",
    );
    assert.match(
      content,
      /tests\/helpers\//,
      "hook must fall back to the full suite for helper changes",
    );
    assert.match(
      content,
      /tests\/repo_rules\.test\.mjs/,
      "hook must run repo_rules.test.mjs when Markdown docs are staged",
    );
    assert.match(
      content,
      /grep -vE 'HIGH CHURN/,
      "hook must hide churn warnings from the fixed-threshold project memory check",
    );
    assert.match(
      content,
      /possibly-stale memor/,
      "hook must hide fixed-threshold stale-memory spam while keeping failed attempts and open issues",
    );
    assert.match(
      content,
      /isVersionOnlyDiff/,
      "hook must support fast repo_rules check on version-only release commits",
    );
    assert.match(
      content,
      /Pre-commit: version-only diff/,
      "hook must announce the version-only fast path so silent fallbacks stay visible",
    );
    assert.ok(fs.statSync(target).mode & 0o111, "hook must be executable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(
    isVersionOnlyDiff(
      [
        '-  "version": "2026.11.16.3",',
        '+  "version": "2026.11.17",',
        '-export const APP_VERSION = "2026.11.16.3";',
        '+export const APP_VERSION = "2026.11.17";',
        "-    <title>Galway 2664 // Ocean 6502-SID Workbench (1985-87) v2026.11.16.3</title>",
        "+    <title>Galway 2664 // Ocean 6502-SID Workbench (1985-87) v2026.11.17</title>",
        '-    href="./src/styles.css?v=2026.11.16.3"',
        '+    href="./src/styles.css?v=2026.11.17"',
        '-    <link rel="stylesheet" href="./src/styles/foundation.css?v=2026.11.16.3">',
        '+    <link rel="stylesheet" href="./src/styles/foundation.css?v=2026.11.17">',
        '-    href="./src/styles/overlays.css?v=2026.11.16.3"',
        '+    href="./src/styles/overlays.css?v=2026.11.17"',
        '-    <span class="customBadge" id="app-version">v2026.11.16.3</span>',
        '+    <span class="customBadge" id="app-version">v2026.11.17</span>',
      ].join("\n"),
    ),
    true,
  );
  assert.equal(
    isVersionOnlyDiff(
      [
        '-  "version": "2026.11.16.3",',
        '+  "version": "2026.11.17",',
        '+    <div class="extra">markup edit</div>',
      ].join("\n"),
    ),
    false,
  );

  const htmlBefore = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").split(/\r?\n/);
  const htmlAfter = updateHtmlVersion(htmlBefore.join("\n"), "2099.01.02").split(/\r?\n/);
  const htmlDiff = htmlBefore
    .flatMap((line, idx) => (line === htmlAfter[idx] ? [] : [`-${line}`, `+${htmlAfter[idx]}`]))
    .join("\n");
  assert.equal(
    isVersionOnlyDiff(htmlDiff),
    true,
    "isVersionOnlyDiff must accept the real diff produced by updateHtmlVersion on index.html",
  );

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["hooks:install"],
    "node scripts/install_hooks.mjs",
    "package.json must expose npm run hooks:install",
  );
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("npm run hooks:install"), "README must document the hook install step");
});

test("browser release gates stay out of CI workflow", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/checks.yml"), "utf8");
  const deployScript = fs.readFileSync(path.join(ROOT, "scripts/deploy.mjs"), "utf8");
  const docs = fs.readFileSync(path.join(ROOT, "docs/agents/browser-verification.md"), "utf8");

  for (const gate of ["check:help-popovers", "check:layout"]) {
    assert.ok(deployScript.includes(gate), `scripts/deploy.mjs must run ${gate} before pushing`);
    assert.ok(
      !workflow.includes(gate),
      `checks.yml must not run ${gate}. It needs a pinned Chromium and font-independent tolerances; see CODING_STANDARDS Rule 6.4.`,
    );
  }
  assert.match(
    docs,
    /## Release-only checks/,
    "browser-verification.md must keep the release-only rationale so the split is discoverable",
  );
});

test("CI workflows and package engines target Node 24", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const checksWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/checks.yml"), "utf8");
  const closeGuardWorkflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/issue-close-guard.yml"),
    "utf8",
  );

  assert.equal(pkg.engines?.node, ">=24.14.0");
  assert.match(checksWorkflow, /uses:\s*actions\/checkout@v7\b/);
  assert.match(checksWorkflow, /uses:\s*actions\/setup-node@v7\b/);
  assert.match(checksWorkflow, /node-version:\s*24\b/);
  assert.match(closeGuardWorkflow, /uses:\s*actions\/github-script@v9\b/);
});

test("agent steering pointers resolve to existing docs", () => {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const pointers = new Set(
    Array.from(agents.matchAll(/docs\/agents\/[a-z0-9-]+\.md/g), (match) => match[0]),
  );
  assert.ok(pointers.size > 0, "AGENTS.md must point at docs/agents references");
  for (const pointer of pointers) {
    assert.ok(
      fs.existsSync(path.join(ROOT, pointer)),
      `AGENTS.md points at missing doc "${pointer}"`,
    );
  }
});

const RETIRED_PUBLIC_SYMBOLS = [
  "createAudioContextManager",
  "startTapeSound",
  "onFirstInteraction",
];

function findRetiredSymbolViolations(documentName, text, symbols = RETIRED_PUBLIC_SYMBOLS) {
  const violations = [];
  for (const symbol of symbols) {
    if (new RegExp(`\\b${symbol}\\b`).test(text)) {
      violations.push(
        `${documentName} must not cite retired symbol "${symbol}". Document the replacement seam instead.`,
      );
    }
  }
  return violations;
}

function findBehavioralSourceReadViolations(relPath, text) {
  const violations = [];
  const pattern = /\b(?:readFileSync|readFile)\s*\([^;\n]*?src\/[^"')\s]+\.js\b/g;
  for (const match of text.matchAll(pattern)) {
    violations.push(
      `${relPath} inspects JS source directly (${match[0].trim()}); assert observable behaviour through module seams instead.`,
    );
  }
  return violations;
}

test("current documentation avoids retired public symbols and behavioural tests avoid reading src/*.js", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const narrative = fs.readFileSync(path.join(ROOT, "NARRATIVE.md"), "utf8");
  const blogStart = narrative.indexOf("## 8. Development blog");
  assert.ok(blogStart > -1, "NARRATIVE.md must keep the Section 8 heading");
  const narrativeCurrent = narrative.slice(0, blogStart);

  const docViolations = [
    ...findRetiredSymbolViolations("README.md", readme),
    ...findRetiredSymbolViolations("NARRATIVE.md sections 1 to 7", narrativeCurrent),
  ];
  assert.deepEqual(docViolations, [], docViolations.join("\n"));

  const negativeDoc = findRetiredSymbolViolations(
    "README.md",
    "Uses createAudioContextManager and onFirstInteraction.",
  );
  assert.equal(negativeDoc.length, 2, "Retired symbol check must reject stale public symbols");

  const testsDir = path.join(ROOT, "tests");
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((file) => file.endsWith(".test.mjs") && file !== "repo_rules.test.mjs")
    .sort();
  assert.ok(testFiles.length > 0);

  const sourceReadViolations = [];
  for (const file of testFiles) {
    const relPath = `tests/${file}`;
    const content = fs.readFileSync(path.join(testsDir, file), "utf8");
    sourceReadViolations.push(...findBehavioralSourceReadViolations(relPath, content));
  }
  assert.deepEqual(sourceReadViolations, [], sourceReadViolations.join("\n"));

  const negativeTest = findBehavioralSourceReadViolations(
    "tests/example.test.mjs",
    'const code = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");',
  );
  assert.equal(negativeTest.length, 1, "Source-read guardrail must reject JS source inspection");
});

test("worktree helper links root node_modules entries as a directory and cleans up before removal", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-worktree-"));
  const rootDir = path.join(tmpDir, "repo");
  const wtDir = path.join(tmpDir, "wt-114");
  try {
    fs.mkdirSync(path.join(rootDir, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "node_modules", "@biomejs"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "node_modules", ".package-lock.json"), "{}");

    const gitCalls = [];
    const fakeExec = (cmd, args) => {
      gitCalls.push([cmd, ...args]);
      if (args[0] === "worktree" && args[1] === "add") {
        fs.mkdirSync(args[2], { recursive: true });
      }
      if (args[0] === "worktree" && args[1] === "remove") {
        assert.equal(
          fs.existsSync(path.join(args[2], "node_modules")),
          false,
          "node_modules must be removed before git worktree remove runs",
        );
        fs.rmSync(args[2], { recursive: true, force: true });
      }
      return "";
    };

    const added = addWorktree({
      rootDir,
      worktreePath: wtDir,
      branch: "ticket-114-test",
      base: "main",
      execFile: fakeExec,
      log: () => {},
    });
    assert.deepEqual(added.linked.sort(), [".bin", ".package-lock.json", "@biomejs"]);
    const wtModules = path.join(wtDir, "node_modules");
    assert.equal(fs.lstatSync(wtModules).isDirectory(), true);
    assert.equal(fs.lstatSync(wtModules).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(wtModules, "@biomejs")).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(wtModules, ".package-lock.json")).isSymbolicLink(), true);

    // Re-running linkWorktreeDependencies refreshes existing links cleanly.
    const relinked = linkWorktreeDependencies({ rootDir, worktreePath: wtDir });
    assert.equal(relinked.length, 3);

    removeWorktree({
      rootDir,
      worktreePath: wtDir,
      execFile: fakeExec,
      log: () => {},
    });
    assert.deepEqual(gitCalls, [
      ["git", "worktree", "add", wtDir, "-b", "ticket-114-test", "main"],
      ["git", "worktree", "remove", wtDir],
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("calendar version is synchronized across all seven release locations", () => {
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
    /<title>Galway 2664 \/\/ Ocean 6502-SID Workbench \(1985-87\) v([^<]+)<\/title>/,
  );
  assert.ok(titleMatch, "index.html title must declare CalVer version");
  assert.equal(titleMatch[1], calver, "index.html title version must match package.json");

  const badgeMatch = html.match(/<span\b[^>]*\bid="app-version"[^>]*>v([^<]+)<\/span>/);
  assert.ok(badgeMatch, "index.html header badge must declare CalVer version");
  assert.equal(badgeMatch[1], calver, "index.html header badge version must match package.json");

  const stylesheetLinks = extractStylesheetLinks(html);
  assert.ok(stylesheetLinks.length > 0, "index.html must link at least one local CSS stylesheet");
  for (const link of stylesheetLinks) {
    assert.ok(
      link.version,
      `index.html stylesheet "${link.path}" must carry a CalVer query string`,
    );
    assert.equal(
      link.version,
      calver,
      `index.html stylesheet "${link.path}" query string must match package.json`,
    );
  }

  const mainMatch = html.match(/src="\.\/src\/main\.js\?v=([^"]+)"/);
  assert.ok(mainMatch, "index.html script must carry a CalVer query string");
  assert.equal(mainMatch[1], calver, "index.html script query string must match package.json");
});

test("verifyDeploy polls Pages workflow, verifies live version, and pushes deploy tag", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "galway-verify-deploy-"));
  const versionFile = path.join(dir, "version.js");
  fs.writeFileSync(versionFile, 'export const APP_VERSION = "2026.11.17.1";\n', "utf8");
  const headSha = "e55d478db30f70ff059e3c8d1ad5532a97dce79b";
  let listCalls = 0;
  const gitCalls = [];

  try {
    const fakeExecFile = (cmd, args) => {
      if (cmd === "git") {
        gitCalls.push(args);
        if (args[0] === "rev-parse") return `${headSha}\n`;
        if (args[0] === "tag" && args[1] === "-l") return "";
        return "";
      }
      if (cmd === "gh" && args[1] === "list") {
        listCalls += 1;
        return JSON.stringify([
          {
            databaseId: 43997286625,
            name: "pages build and deployment",
            headSha,
            status: listCalls === 1 ? "in_progress" : "completed",
            conclusion: listCalls === 1 ? null : "success",
          },
        ]);
      }
      if (cmd === "gh" && args[1] === "view") {
        return JSON.stringify({
          headSha,
          status: "completed",
          conclusion: "success",
          jobs: [{ name: "deploy", status: "completed", conclusion: "success" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd} ${args.join(" ")}`);
    };

    const result = await verifyDeploy({
      execFile: fakeExecFile,
      fetchImpl: async () => ({
        ok: true,
        text: async () => 'export const APP_VERSION = "2026.11.17.1";\n',
      }),
      sleep: async () => {},
      log: () => {},
      versionPath: versionFile,
      maxAttempts: 3,
      pollIntervalMs: 1,
    });

    assert.equal(listCalls, 2);
    assert.equal(result.version, "2026.11.17.1");
    assert.equal(result.runId, "43997286625");
    assert.equal(result.tagName, "deploy-v2026.11.17.1");
    assert.deepEqual(gitCalls, [
      ["rev-parse", "HEAD"],
      ["tag", "-l", "deploy-v2026.11.17.1"],
      ["tag", "deploy-v2026.11.17.1", headSha],
      ["push", "fork", "deploy-v2026.11.17.1"],
    ]);

    await assert.rejects(
      () =>
        verifyDeploy({
          execFile: fakeExecFile,
          fetchImpl: async () => ({
            ok: true,
            text: async () => 'export const APP_VERSION = "2026.11.17";\n',
          }),
          sleep: async () => {},
          log: () => {},
          versionPath: versionFile,
          maxAttempts: 3,
          pollIntervalMs: 1,
        }),
      /Live version mismatch: expected 2026\.11\.17\.1, got 2026\.11\.17/,
    );

    const prevHttpProxy = process.env.HTTP_PROXY;
    const prevHttpsProxy = process.env.HTTPS_PROXY;
    const prevNoProxy = process.env.NO_PROXY;
    const prevNoProxyLower = process.env.no_proxy;
    const prevEnvProxyFlag = process.env.NODE_USE_ENV_PROXY;
    const target = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end('export const APP_VERSION = "2026.11.17.1";\n');
    });
    let connectCount = 0;
    const proxy = http.createServer();
    proxy.on("connect", (req, clientSocket, head) => {
      connectCount += 1;
      const [host, port] = req.url.split(":");
      const upstream = net.connect(Number(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
    });
    try {
      await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
      await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const targetPort = target.address().port;
      const proxyPort = proxy.address().port;
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
      process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;
      delete process.env.NODE_USE_ENV_PROXY;

      await verifyDeploy({
        execFile: fakeExecFile,
        sleep: async () => {},
        log: () => {},
        versionPath: versionFile,
        liveUrl: `http://127.0.0.1:${targetPort}/`,
        maxAttempts: 3,
        pollIntervalMs: 1,
      });
      assert.equal(
        connectCount,
        1,
        "verifyDeploy must route live version fetch through HTTP_PROXY",
      );

      // Scoped proxy configuration must be restored once verifyDeploy completes.
      await fetch(`http://127.0.0.1:${targetPort}/src/version.js`);
      assert.equal(
        connectCount,
        1,
        "verifyDeploy must restore global proxy settings after returning",
      );
    } finally {
      proxy.closeAllConnections();
      target.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => target.close(resolve)),
      ]);
      if (prevHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = prevHttpProxy;
      if (prevHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prevHttpsProxy;
      if (prevNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = prevNoProxy;
      if (prevNoProxyLower === undefined) delete process.env.no_proxy;
      else process.env.no_proxy = prevNoProxyLower;
      if (prevEnvProxyFlag === undefined) delete process.env.NODE_USE_ENV_PROXY;
      else process.env.NODE_USE_ENV_PROXY = prevEnvProxyFlag;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ALLOWED_TECHNICAL_ING = new Set([
  "padding",
  "spacing",
  "sizing",
  "rendering",
  "timing",
  "ring",
  "string",
]);

const ALLOWED_UTILITY_CLASSES = new Set(["hidden", "srOnly", "c64Caps"]);
const MAINTAINABLE_CLASS_PATTERN =
  /^[a-z][a-zA-Z0-9]*(?:-[a-z][a-zA-Z0-9]*)?(?:-is[A-Z][a-zA-Z0-9]*)?(?:--[a-z][a-zA-Z0-9]*)?$/;
const FORBIDDEN_CLASS_PATTERNS = [/^is(?:[A-Z]|-)/, /^(?:active|c64-caps|sr-only)$/];
const SINGLE_CLASS_SELECTOR_PATTERN =
  /^\.[a-z][a-zA-Z0-9]*(?:-[a-z][a-zA-Z0-9]*)?(?:-is[A-Z][a-zA-Z0-9]*)?(?:--[a-z][a-zA-Z0-9]*)?(?::(?:hover|active|focus|focus-visible)|::(?:before|after))?$/;
const MOBILE_TAB_BYPASS_PATTERN =
  /^\.workbenchShell-grid\[data-mobile-view="[a-z]+"\] \.[a-z][a-zA-Z0-9-]*$/;
const LEAF_PROSE_SELECTOR_PATTERN =
  /^\.(?:archNotes|narrativeProse|gameMetaCard) (?:h[1-6]|p|strong|em|blockquote|ul|ol|li|pre(?: code)?|code|hr)$/;
const MODULE_STRUCTURAL_SELECTORS = new Map([
  ["foundation.css", [/^(?:\*|:root|html|body)$/]],
  ["buttons.css", [/^button(?::(?:hover|active))?$/]],
  [
    "boot-sequence.css",
    [
      /^(?:html\[data-boot-mode="immediate"\] )?(?:body\[data-boot-state="booting"\] \.workbenchShell|\.bootSequence)$/,
    ],
  ],
  [
    "hardware-controls.css",
    [
      /^\.hardwareControls-toggleInput:(?:checked|focus-visible) \+ \.hardwareControls-toggleSwitch(?:::after)?$/,
    ],
  ],
  [
    "top-bar.css",
    [/^(?:\.topBar-logo-isSparkling )?\.topBar-logoSvg path(?::nth-of-type\(\d+\))?$/],
  ],
  ["workbench-shell.css", [/^::-webkit-scrollbar(?:-(?:track|thumb(?::hover)?))?$/]],
]);

function isValidMaintainableClass(token) {
  return (
    ALLOWED_UTILITY_CLASSES.has(token) ||
    (MAINTAINABLE_CLASS_PATTERN.test(token) &&
      !FORBIDDEN_CLASS_PATTERNS.some((pattern) => pattern.test(token)))
  );
}

function isAllowedModuleSelector(fileName, selectorPart) {
  if (SINGLE_CLASS_SELECTOR_PATTERN.test(selectorPart)) return true;
  if (MOBILE_TAB_BYPASS_PATTERN.test(selectorPart)) return true;
  if (
    (fileName === "modal.css" || fileName === "source-panel.css") &&
    LEAF_PROSE_SELECTOR_PATTERN.test(selectorPart)
  ) {
    return true;
  }
  const extraPatterns = MODULE_STRUCTURAL_SELECTORS.get(fileName) ?? [];
  return extraPatterns.some((pattern) => pattern.test(selectorPart));
}

function findCssModuleViolations(
  relPath,
  text,
  { retiredGlossaryTerms = collectRetiredGlossaryTerms() } = {},
) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  if (lines.length >= 450) {
    violations.push(`${relPath} must stay under 450 lines (got ${lines.length})`);
  }

  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!/@layer\b/.test(withoutComments)) {
    violations.push(`${relPath} must declare or wrap rules in @layer`);
  }
  if (/!important\b/i.test(withoutComments)) {
    violations.push(`${relPath} must contain zero !important declarations`);
  }
  if (
    path.basename(relPath) !== "foundation.css" &&
    /\bz-index\s*:\s*-?\d+/i.test(withoutComments)
  ) {
    violations.push(`${relPath} must use --z-* tokens instead of raw integer z-index values`);
  }

  // Strip strings and declaration values so hex colours do not trigger ID selector checks.
  const withoutValues = withoutComments
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/:[^;{}]+(?=[;}])/g, "");
  const selectorHasId = parseStylesheet(text).some((rule) =>
    /#[a-zA-Z_-][a-zA-Z0-9_-]*/.test(rule.selector.replace(/\[[^\]]*\]/g, "")),
  );
  if (selectorHasId || /#[a-zA-Z_-][a-zA-Z0-9_-]*/.test(withoutValues)) {
    violations.push(`${relPath} must contain zero ID style selectors`);
  }

  for (const match of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const rawLines = match[0]
      .replace(/^\/\*|\*\/$/g, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/={3,}/g, "").trim())
      .filter(Boolean);
    if (rawLines.length === 0) continue;

    const isBanner = match[0].includes("====");
    const proseLines = isBanner && rawLines.length > 1 ? rawLines.slice(1) : rawLines;
    const cleaned = proseLines.join(" ").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;

    const lowerCleaned = cleaned.toLowerCase();
    for (const term of retiredGlossaryTerms) {
      if (lowerCleaned.includes(term.toLowerCase())) {
        violations.push(
          `${relPath} CSS comment must not use GLOSSARY _Avoid_ term "${term}": "${cleaned}"`,
        );
      }
    }

    const body = cleaned.includes("CAUTION:") ? cleaned.split("CAUTION:")[1].trim() : cleaned;
    if (cleaned.includes("CAUTION:")) {
      const sentences = body
        .split(/\.(?:\s+|$)/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length < 2) {
        violations.push(
          `${relPath} CAUTION comment must state [Preventive action]. [Consequence].: "${cleaned}"`,
        );
      }
    }

    const proseOnly = body.replace(/`[^`]+`/g, "");
    for (const word of proseOnly.match(/\b[a-z]+ing\b/gi) ?? []) {
      if (!ALLOWED_TECHNICAL_ING.has(word.toLowerCase())) {
        violations.push(`${relPath} CSS comment uses non-STE-80 -ing word "${word}": "${cleaned}"`);
      }
    }

    for (const sentence of body
      .split(/\.(?:\s+|$)/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      if (words.length > 25) {
        violations.push(
          `${relPath} CSS comment sentence exceeds 25 words (${words.length}): "${sentence}"`,
        );
      }
    }
  }

  return violations;
}

function findMaintainableCssViolations(relPath, text) {
  const fileName = path.basename(relPath);
  const violations = [];

  for (const rule of parseStylesheet(text)) {
    for (const part of rule.selector.split(",").map((s) => s.trim())) {
      if (!isAllowedModuleSelector(fileName, part)) {
        violations.push(
          `${relPath} selector "${part}" must use single-class MaintainableCSS grammar`,
        );
      }
      const withoutAttrStrings = part.replace(/\[[^\]]*\]/g, "");
      for (const match of withoutAttrStrings.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
        if (!isValidMaintainableClass(match[1])) {
          violations.push(
            `${relPath} class ".${match[1]}" must use MaintainableCSS lowerCamelCase grammar`,
          );
        }
      }
    }
  }

  return violations;
}

test("CSS architecture guardrails reject ID selectors, !important, oversized modules, and non-MaintainableCSS names", () => {
  const validCss = [
    "/* Header: valid module comment. */",
    "@layer modules {",
    "  .hidden { display: none; }",
    "  .srOnly { position: absolute; }",
    "  .c64Caps { text-transform: uppercase; }",
    "  .panel-header { color: #abc }",
    "  .panel-badge-isError { border-color: #ff4d63; }",
    "  .panel--left { min-width: 0; }",
    "}",
  ].join("\n");
  assert.deepEqual(findCssModuleViolations("src/styles/example.css", validCss), []);
  assert.deepEqual(findMaintainableCssViolations("src/styles/example.css", validCss), []);

  const idSelectorViolations = findCssModuleViolations(
    "src/styles/example.css",
    "@layer modules { #app-version { color: red; } }",
  );
  assert.ok(
    idSelectorViolations.some((msg) => msg.includes("ID style selector")),
    `Expected ID selector violation, got: ${idSelectorViolations.join("; ")}`,
  );

  const importantViolations = findCssModuleViolations(
    "src/styles/example.css",
    "@layer modules { .panel { display: none !important; } }",
  );
  assert.ok(
    importantViolations.some((msg) => msg.includes("!important")),
    `Expected !important violation, got: ${importantViolations.join("; ")}`,
  );

  const overLineBudget = `${Array.from({ length: 450 }, () => "/* line */").join("\n")}`;
  const lineViolations = findCssModuleViolations(
    "src/styles/example.css",
    `@layer modules {\n${overLineBudget}`,
  );
  assert.ok(
    lineViolations.some((msg) => msg.includes("under 450 lines")),
    `Expected line budget violation, got: ${lineViolations.join("; ")}`,
  );

  for (const badSelector of [
    ".btn-mini-action",
    ".is-open",
    ".isOpen",
    ".active",
    ".c64-caps",
    ".sr-only",
    ".PanelHeader",
    ".panel_header",
    ".panel .panel-title",
    ".panel.panel--left",
  ]) {
    const violations = findMaintainableCssViolations(
      "src/styles/example.css",
      `@layer modules { ${badSelector} { color: red; } }`,
    );
    assert.ok(
      violations.length > 0,
      `Expected MaintainableCSS violation for selector "${badSelector}"`,
    );
  }
});

test("linked CSS modules stay under 450 lines with @layer, zero !important, zero ID selectors, and STE-80 comments", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /<style\b/i, "index.html must not embed inline <style> blocks");

  const links = extractStylesheetLinks(html);
  assert.ok(links.length > 0, "index.html must link module stylesheets");

  const stylesDir = path.join(ROOT, "src/styles");
  const diskFiles = fs
    .readdirSync(stylesDir)
    .filter((f) => f.endsWith(".css"))
    .sort();
  assert.ok(diskFiles.length > 0, "src/styles/ must contain extracted CSS modules");

  const linkedRelPaths = links.map((link) => path.normalize(link.path));
  assert.deepEqual(
    [...linkedRelPaths].sort(),
    diskFiles.map((file) => path.normalize(`src/styles/${file}`)),
    "index.html linked stylesheets must match all CSS modules in src/styles/",
  );

  const retiredGlossaryTerms = collectRetiredGlossaryTerms();
  const violations = [];
  for (const relPath of linkedRelPaths) {
    const text = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    violations.push(...findCssModuleViolations(relPath, text, { retiredGlossaryTerms }));
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("all CSS modules and HTML markup enforce MaintainableCSS lowerCamelCase class grammar", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const links = extractStylesheetLinks(html);
  const violations = [];
  const allRules = [];
  const hoverPropsByBase = new Map();

  for (const link of links) {
    const relPath = path.normalize(link.path);
    const file = path.basename(relPath);
    const css = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    violations.push(...findMaintainableCssViolations(relPath, css));

    for (const rule of parseStylesheet(css)) {
      allRules.push({ file, ...rule });
      for (const part of rule.selector.split(",").map((s) => s.trim())) {
        const hoverMatch = part.match(/^(\.[a-z][a-zA-Z0-9-]*):hover$/);
        if (hoverMatch) {
          const props = hoverPropsByBase.get(hoverMatch[1]) || new Set();
          for (const key of Object.keys(rule.decls)) props.add(key);
          hoverPropsByBase.set(hoverMatch[1], props);
        }
      }
    }
  }

  for (const match of html.matchAll(/\bclass="([^"]+)"/g)) {
    for (const token of match[1].trim().split(/\s+/).filter(Boolean)) {
      if (!isValidMaintainableClass(token)) {
        violations.push(
          `index.html class "${token}" must use MaintainableCSS lowerCamelCase grammar`,
        );
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));

  for (const rule of allRules) {
    for (const part of rule.selector.split(",").map((s) => s.trim())) {
      const stateMatch = part.match(/^(\.[a-z][a-zA-Z0-9-]*)-is[A-Z][a-zA-Z0-9]*$/);
      if (!stateMatch) continue;
      const base = stateMatch[1];
      const baseHover = hoverPropsByBase.get(base) || new Set();
      const buttonHover = base.endsWith("-button")
        ? hoverPropsByBase.get(".button") || new Set()
        : new Set();
      const overlapsHover = Object.keys(rule.decls).some(
        (k) => baseHover.has(k) || buttonHover.has(k),
      );
      if (!overlapsHover) continue;
      const hasHoverPair = allRules.some((other) =>
        other.selector
          .split(",")
          .map((s) => s.trim())
          .includes(`${part}:hover`),
      );
      assert.ok(
        hasHoverPair,
        `src/styles/${rule.file} "${part}" overrides :hover properties and must pair with "${part}:hover"`,
      );
    }
  }
});
