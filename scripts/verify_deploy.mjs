#!/usr/bin/env node
// Verifies the live GitHub Pages deployment for HEAD and pushes deploy-v<CalVer> to fork.
// Leaves known-good-v<CalVer> manual until the user confirms the live build; see docs/agents/deployment.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "charlesroper/C64_music";
const LIVE_URL = "https://charlesroper.github.io/C64_music/";
const PAGES_WORKFLOW = "pages build and deployment";

export function findMatchingPagesRun(runs, headSha) {
  return runs.find((run) => run.name === PAGES_WORKFLOW && run.headSha === headSha) ?? null;
}

export function verifyPagesRunResult(run, headSha) {
  if (!run) {
    throw new Error(`No "${PAGES_WORKFLOW}" workflow run found for ${headSha}.`);
  }
  if (run.headSha !== headSha) {
    throw new Error(`Workflow run SHA mismatch: expected ${headSha}, got ${run.headSha}.`);
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(
      `Workflow run ${run.databaseId ?? "unknown"} is not green: status=${run.status}, conclusion=${run.conclusion}.`,
    );
  }
  const deployJob = (run.jobs || []).find((job) => job.name === "deploy");
  if (deployJob?.status !== "completed" || deployJob?.conclusion !== "success") {
    throw new Error("Pages workflow completed without a successful deploy job.");
  }
}

export function parseAppVersion(sourceText) {
  const match = sourceText.match(/export const APP_VERSION = "([^"]+)";/);
  if (!match) {
    throw new Error("Could not parse APP_VERSION from src/version.js.");
  }
  return match[1];
}

function defaultExecFile(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export async function verifyDeploy(options = {}) {
  const {
    execFile = defaultExecFile,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
    versionPath = path.join(ROOT, "src/version.js"),
    remote = "fork",
    maxAttempts = 20,
    pollIntervalMs = 3000,
  } = options;

  const headSha = execFile("git", ["rev-parse", "HEAD"]).trim();
  const shortSha = headSha.slice(0, 7);
  const expectedVersion = parseAppVersion(fs.readFileSync(versionPath, "utf8"));

  if (
    !process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy)
  ) {
    process.env.NODE_USE_ENV_PROXY = "1";
  }

  let matchedRun = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rawRuns = execFile("gh", [
      "run",
      "list",
      "-R",
      REPO,
      "--branch",
      "main",
      "--limit",
      "10",
      "--json",
      "databaseId,name,headSha,status,conclusion",
    ]);
    const runs = JSON.parse(rawRuns);
    matchedRun = findMatchingPagesRun(runs, headSha);
    if (matchedRun && matchedRun.status === "completed") break;
    if (attempt < maxAttempts) await sleep(pollIntervalMs);
  }

  if (matchedRun?.status !== "completed") {
    throw new Error(`Timed out waiting for "${PAGES_WORKFLOW}" on commit ${shortSha}.`);
  }

  const runId = String(matchedRun.databaseId);
  const rawView = execFile("gh", [
    "run",
    "view",
    runId,
    "-R",
    REPO,
    "--json",
    "headSha,status,conclusion,jobs",
  ]);
  const runView = JSON.parse(rawView);
  verifyPagesRunResult({ ...runView, databaseId: runId }, headSha);

  const versionUrl = `${LIVE_URL}src/version.js`;
  const response = await fetchImpl(versionUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Live version check failed (${response.status}) at ${versionUrl}.`);
  }
  const liveVersion = parseAppVersion(await response.text());
  if (liveVersion !== expectedVersion) {
    throw new Error(`Live version mismatch: expected ${expectedVersion}, got ${liveVersion}.`);
  }

  const tagName = `deploy-v${expectedVersion}`;
  const existingTarget = execFile("git", ["tag", "-l", tagName]).trim();
  if (!existingTarget) {
    execFile("git", ["tag", tagName, headSha]);
  }
  execFile("git", ["push", remote, tagName]);

  log(`Live URL: ${LIVE_URL}`);
  log(`CalVer: ${liveVersion}`);
  log(`Commit: ${shortSha} (${headSha})`);
  log(`Workflow run ID: ${runId}`);
  log(`Deploy tag pushed: ${tagName} (${remote})`);
  return { liveUrl: LIVE_URL, version: liveVersion, headSha, shortSha, runId, tagName };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyDeploy().catch((error) => {
    console.error(`Deploy verification failed: ${error.message}`);
    process.exit(1);
  });
}
