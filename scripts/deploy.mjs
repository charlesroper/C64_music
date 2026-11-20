#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export function verifyCleanTree(exec = execSync) {
  const status = exec("git status --porcelain", { encoding: "utf8" }).toString().trim();
  if (status.length > 0) {
    throw new Error("Working tree is dirty. Commit or stash changes before deploying.");
  }
}

export function verifyRemote(remote = "fork", exec = execSync) {
  try {
    const url = exec(`git remote get-url ${remote}`, { encoding: "utf8" }).toString().trim();
    if (!url) {
      throw new Error(`Git remote "${remote}" is missing.`);
    }
  } catch (_err) {
    throw new Error(`Git remote "${remote}" is missing. Add the remote before deploying.`);
  }
}

export function verifyNarrativeCommitLinks(narrativePath = path.join(ROOT, "NARRATIVE.md")) {
  const narrative = fs.readFileSync(narrativePath, "utf8");
  const blogStart = narrative.indexOf("## 8. Development blog");
  if (blogStart === -1) return;
  const blog = narrative.slice(blogStart);
  const lastEntryIndex = blog.lastIndexOf("\n### ");
  if (lastEntryIndex === -1) return;
  const lastEntry = blog.slice(lastEntryIndex);
  if (!/https:\/\/github\.com\/charlesroper\/C64_music\/commit\/[0-9a-f]{7,}/i.test(lastEntry)) {
    throw new Error(
      "Latest NARRATIVE.md Section 8 entry has no commit link. Record the commit hash before deploying.",
    );
  }
}

export function deploy(options = {}) {
  const {
    exec = execSync,
    remote = "fork",
    branch = "main",
    log = console.log,
    narrativePath = path.join(ROOT, "NARRATIVE.md"),
  } = options;

  log("1. Checking working tree state...");
  verifyCleanTree(exec);

  log(`2. Verifying git remote "${remote}" exists...`);
  verifyRemote(remote, exec);

  log("3. Verifying NARRATIVE.md Section 8 commit links...");
  verifyNarrativeCommitLinks(narrativePath);

  log("4. Running lint and format check...");
  exec("npm run check:lint", { stdio: "inherit" });

  log("5. Running automated test suite...");
  exec("npm test", { stdio: "inherit" });

  log("6. Running help popover browser checks...");
  exec("npm run check:help-popovers", { stdio: "inherit" });

  log("7. Running layout browser checks...");
  exec("npm run check:layout", { stdio: "inherit" });

  log(`8. Pushing to GitHub Pages (${remote}/${branch})...`);
  exec(`git push ${remote} ${branch}`, { stdio: "inherit" });

  log("9. Deployment status:");
  const commit = exec("git rev-parse --short HEAD", { encoding: "utf8" }).toString().trim();
  log(`Successfully pushed commit ${commit} to ${remote}/${branch}.`);
  log("GitHub Pages URL: https://charlesroper.github.io/C64_music/");
  return { commit, remote, branch };
}

if (import.meta.main) {
  try {
    deploy();
  } catch (err) {
    console.error(`Deployment failed: ${err.message}`);
    process.exit(1);
  }
}
