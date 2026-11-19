#!/usr/bin/env node
// Manage git worktrees with gitignored inner symlinks into the root node_modules directory.
// Usage: npm run worktree:add -- <path> <branch> [base]
//        npm run worktree:remove -- <path>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Symlink every entry from root node_modules into a worktree node_modules directory. */
export function linkWorktreeDependencies({ rootDir = ROOT, worktreePath, fsImpl = fs } = {}) {
  if (!worktreePath) throw new Error("worktreePath is required.");
  const srcModules = path.join(rootDir, "node_modules");
  if (!fsImpl.existsSync(srcModules)) return [];

  const destModules = path.join(path.resolve(rootDir, worktreePath), "node_modules");
  fsImpl.mkdirSync(destModules, { recursive: true });

  const linked = [];
  for (const entry of fsImpl.readdirSync(srcModules)) {
    const target = path.join(srcModules, entry);
    const linkPath = path.join(destModules, entry);
    if (fsImpl.existsSync(linkPath)) {
      fsImpl.rmSync(linkPath, { recursive: true, force: true });
    }
    const stat = fsImpl.lstatSync(target);
    fsImpl.symlinkSync(target, linkPath, stat.isDirectory() ? "dir" : "file");
    linked.push(entry);
  }
  return linked;
}

/** Create a git worktree branch and link root node_modules entries inside it. */
export function addWorktree({
  rootDir = ROOT,
  worktreePath,
  branch,
  base = "HEAD",
  execFile = execFileSync,
  fsImpl = fs,
  log = console.log,
} = {}) {
  if (!worktreePath || !branch) {
    throw new Error("Usage: npm run worktree:add -- <path> <branch> [base]");
  }
  const resolved = path.resolve(rootDir, worktreePath);
  execFile("git", ["worktree", "add", resolved, "-b", branch, base], {
    cwd: rootDir,
    stdio: "inherit",
  });
  const linked = linkWorktreeDependencies({ rootDir, worktreePath: resolved, fsImpl });
  log(`Worktree ready at ${resolved} (${branch}), linked ${linked.length} node_modules entries.`);
  return { worktreePath: resolved, branch, linked };
}

/** Remove linked node_modules directory and delete the git worktree cleanly. */
export function removeWorktree({
  rootDir = ROOT,
  worktreePath,
  execFile = execFileSync,
  fsImpl = fs,
  log = console.log,
} = {}) {
  if (!worktreePath) {
    throw new Error("Usage: npm run worktree:remove -- <path>");
  }
  const resolved = path.resolve(rootDir, worktreePath);
  const destModules = path.join(resolved, "node_modules");
  if (fsImpl.existsSync(destModules)) {
    fsImpl.rmSync(destModules, { recursive: true, force: true });
  }
  execFile("git", ["worktree", "remove", resolved], {
    cwd: rootDir,
    stdio: "inherit",
  });
  log(`Removed worktree at ${resolved}.`);
  return { worktreePath: resolved };
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "add") {
    const [worktreePath, branch, base] = rest;
    addWorktree({ worktreePath, branch, ...(base ? { base } : {}) });
    return;
  }
  if (command === "remove") {
    const [worktreePath] = rest;
    removeWorktree({ worktreePath });
    return;
  }
  console.error("Usage: node scripts/worktree.mjs <add <path> <branch> [base] | remove <path>>");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
