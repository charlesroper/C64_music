import { rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  defaultBrowserCache,
  ENGINE_NAMES,
  keepEntriesForHost,
  planBrowserCleanup,
  resolveBrowserEngine,
} from "./browser_engines.mjs";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

function check() {
  const cacheDir = defaultBrowserCache();
  console.log(`Browser cache: ${cacheDir}`);
  console.log("engine      revision  source       ready  path");
  let missing = false;
  for (const name of ENGINE_NAMES) {
    try {
      const resolved = resolveBrowserEngine(name);
      console.log(
        `${name.padEnd(11)} ${String(resolved.revision ?? "-").padEnd(9)} ${resolved.source.padEnd(12)} ${"ok".padEnd(6)} ${resolved.path}`,
      );
      if (resolved.warning) console.warn(`warning: ${resolved.warning}`);
    } catch (error) {
      missing = true;
      console.error(
        `${name.padEnd(11)} ${"-".padEnd(9)} ${"-".padEnd(12)} ${"MISSING".padEnd(6)} ${error.message}`,
      );
    }
  }
  if (missing) process.exitCode = 1;
}

function clean(apply) {
  const cacheDir = defaultBrowserCache();
  const keep = keepEntriesForHost({ cacheDir });
  const plan = planBrowserCleanup({ cacheDir, keep });

  console.log(`Browser cache: ${plan.cacheDir}`);
  console.log(`Keep (${plan.keep.length}, ${formatBytes(plan.keepBytes)}):`);
  for (const entry of plan.keep) console.log(`  ${entry.name}  ${formatBytes(entry.bytes)}`);
  console.log(`Remove (${plan.remove.length}, ${formatBytes(plan.removeBytes)}):`);
  for (const entry of plan.remove) console.log(`  ${entry.name}  ${formatBytes(entry.bytes)}`);

  if (plan.remove.length === 0) {
    console.log("Cache already lean.");
    return;
  }
  if (!apply) {
    console.log("Dry run. Re-run with --yes to delete the entries above.");
    return;
  }

  let removed = 0;
  for (const entry of plan.remove) {
    rmSync(path.join(plan.cacheDir, entry.name), { recursive: true });
    removed += 1;
  }
  console.log(`Removed ${removed} revisions, freed ${formatBytes(plan.removeBytes)}.`);
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        yes: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parsed;
  const action = positionals[0] ?? "check";
  if (positionals.length > 1) {
    console.error(`Unexpected argument "${positionals[1]}". Use check or clean.`);
    process.exitCode = 1;
    return;
  }
  if (action === "check") {
    if (values.yes) {
      console.error("Option --yes applies only to clean.");
      process.exitCode = 1;
      return;
    }
    check();
  } else if (action === "clean") {
    clean(values.yes);
  } else {
    console.error(`Unknown action "${action}". Use check or clean.`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
