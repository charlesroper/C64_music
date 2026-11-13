#!/usr/bin/env node
// Gate issue closure on checked DoD and acceptance criteria.
// Usage: npm run issue:close -- <number> --comment "reason"

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const CHECKBOX_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
const GH_ATTEMPTS = 3;
const GH_RETRY_DELAY_MS = 1000;

export function auditChecklist(body) {
  const unchecked = [];
  let total = 0;
  for (const match of body.matchAll(CHECKBOX_RE)) {
    total++;
    if (match[1] === " ") unchecked.push(match[2].trim());
  }
  return { total, unchecked };
}

export function isTransientGhError(error) {
  const text = `${error?.stderr ?? ""} ${error?.message ?? ""}`;
  return /unexpected EOF|ECONNRESET|ETIMEDOUT|EAI_AGAIN|HTTP (?:502|503|504)/i.test(text);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function gh(args, input) {
  for (let attempt = 1; attempt <= GH_ATTEMPTS; attempt++) {
    try {
      return execFileSync("gh", args, {
        encoding: "utf8",
        input,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      if (attempt === GH_ATTEMPTS || !isTransientGhError(error)) throw error;
      sleep(GH_RETRY_DELAY_MS * attempt);
    }
  }
}

function usage() {
  console.error('Usage: npm run issue:close -- <number> --comment "reason"');
  console.error("   or: npm run issue:close -- <number> --comment-file path");
  console.error("Optional: --allow-no-checklist, --dry-run");
}

function parseArgs(argv) {
  const args = {
    number: null,
    comment: null,
    commentFile: null,
    allowNoChecklist: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--comment") args.comment = argv[++i];
    else if (arg === "--comment-file") args.commentFile = argv[++i];
    else if (arg === "--allow-no-checklist") args.allowNoChecklist = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (!args.number && /^\d+$/.test(arg)) args.number = Number(arg);
    else {
      usage();
      process.exit(2);
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.number || (!args.comment && !args.commentFile)) {
    usage();
    process.exit(2);
  }

  const issue = JSON.parse(
    gh(["issue", "view", String(args.number), "--json", "number,title,state,url,body"]),
  );
  const { total, unchecked } = auditChecklist(issue.body || "");

  if (total === 0 && !args.allowNoChecklist) {
    console.error(`Refusing to close #${args.number}: no acceptance criteria checklist found.`);
    console.error("Add a task list or pass --allow-no-checklist when the issue truly has no DoD.");
    process.exit(1);
  }

  if (unchecked.length > 0) {
    console.error(`Refusing to close #${args.number}: ${unchecked.length} unchecked item(s).`);
    for (const item of unchecked) console.error(`  - ${item}`);
    console.error(issue.url);
    process.exit(1);
  }

  const comment = args.commentFile ? fs.readFileSync(args.commentFile, "utf8") : args.comment;
  if (args.dryRun) {
    console.log(`Would close #${args.number}: ${issue.title}`);
    console.log(`Verified ${total} checked task item(s).`);
    return;
  }
  gh(["issue", "comment", String(args.number), "--body-file", "-"], comment);
  gh(["issue", "close", String(args.number)]);
  console.log(`Closed #${args.number}: ${issue.title}`);
  console.log(`Verified ${total} checked task item(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
