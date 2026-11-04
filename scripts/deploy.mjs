#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function deploy(options = {}) {
  const { exec = execSync, remote = "fork", branch = "main", log = console.log } = options;

  log("1. Checking working tree state...");
  verifyCleanTree(exec);

  log(`2. Verifying git remote "${remote}" exists...`);
  verifyRemote(remote, exec);

  log("3. Applying Biome formatter...");
  exec("npm run format", { stdio: "inherit" });
  verifyCleanTree(exec);

  log("4. Running lint and format check...");
  exec("npm run lint", { stdio: "inherit" });

  log("5. Running automated test suite...");
  exec("npm test", { stdio: "inherit" });

  log(`6. Pushing to GitHub Pages (${remote}/${branch})...`);
  exec(`git push ${remote} ${branch}`, { stdio: "inherit" });

  log("7. Deployment status:");
  const commit = exec("git rev-parse --short HEAD", { encoding: "utf8" }).toString().trim();
  log(`Successfully pushed commit ${commit} to ${remote}/${branch}.`);
  log("GitHub Pages URL: https://charlesroper.github.io/C64_music/");
  return { commit, remote, branch };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    deploy();
  } catch (err) {
    console.error(`Deployment failed: ${err.message}`);
    process.exit(1);
  }
}
