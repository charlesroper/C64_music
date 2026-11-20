#!/usr/bin/env node
// Gate issue closure on checked DoD and acceptance criteria.
// Usage: npm run issue:close -- <number> --comment "reason"

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { parseArgs as parseNodeArgs } from "node:util";

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
  let parsed;
  try {
    parsed = parseNodeArgs({
      args: argv,
      options: {
        comment: { type: "string" },
        "comment-file": { type: "string" },
        "allow-no-checklist": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
  } catch {
    usage();
    process.exit(2);
  }

  const { values, positionals } = parsed;
  if (positionals.length !== 1 || !/^\d+$/.test(positionals[0])) {
    usage();
    process.exit(2);
  }

  return {
    number: Number(positionals[0]),
    comment: values.comment ?? null,
    commentFile: values["comment-file"] ?? null,
    allowNoChecklist: values["allow-no-checklist"],
    dryRun: values["dry-run"],
  };
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

if (import.meta.main) {
  main(process.argv.slice(2));
}
