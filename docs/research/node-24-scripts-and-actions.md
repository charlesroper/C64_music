# Node 24 optimisation for scripts and GitHub Actions

Research note, 20 November 2026. It investigates how this project can optimise `scripts/` and `.github/workflows/` for Node 24, separating primary-source facts and local `node v24.22.1` checks from what is untested in CI. The note proposes no production change.

Sources: official Node.js v24 API documentation (`https://nodejs.org/docs/latest-v24.x/api/` JSON and HTML specs), the Node.js release schedule (`https://github.com/nodejs/Release/blob/main/schedule.json`), local runtime checks on `node v24.22.1` (V8 `13.6.233.17-node.58`, Undici `7.30.1`) and `@biomejs/biome` `2.6.4`, GitHub's Node 20 deprecation changelog (`https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/`), the `actions/checkout`, `actions/setup-node`, `actions/github-script` and `actions/runner` GitHub repositories, live GitHub Actions logs for `charlesroper/C64_music` (runs `44642498287` and `44490047637`) and this repo's own files.

## Summary

- **CI is behind both local runtime and GitHub runner policy.** Local development runs Node `v24.22.1`, whereas `.github/workflows/checks.yml` runs `node-version: 22` (`v22.23.4` in run `44642498287`). Both workflows still pin `node20` action majors (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/github-script@v7`), which GitHub runners now force onto Node 24 with deprecation warnings (verified in live run logs).
- **Upgrading the three GitHub Actions to current `node24` majors (`checkout@v7`, `setup-node@v7`, `github-script@v9`) and setting `node-version: 24` removes the warnings and aligns CI with local Node 24.** This is read from action source and untested in CI.
- **`scripts/verify_deploy.mjs` has a live Node 24 proxy bug.** Lines 64-72 assign `process.env.NODE_USE_ENV_PROXY = "1"` at runtime inside `verifyDeploy()`. Verified locally on `v24.22.1`, Node ignores `NODE_USE_ENV_PROXY` after startup, so `fetch()` bypasses `HTTPS_PROXY`. Calling `http.setGlobalProxyFromEnv()` (added `v24.14.0`) or passing `--use-env-proxy` at startup fixes it.
- **`scripts/` carries six copies of ESM `__dirname` boilerplate and six slightly different entry-point guards.** Node 24 makes `import.meta.dirname` (unflagged/stable in `v24.0.0`) and `import.meta.main` (added `v24.2.0`) available across all of them, and `util.parseArgs` (`node:util`) covers CLI flags in `close_issue.mjs` and `browsers.mjs`.
- **Two repo guardrails constrain changes.** `tests/repo_rules.test.mjs` requires `npm run check:lint` to run `biome check .` and stay in `checks.yml`, and requires `check:help-popovers` and `check:layout` to stay out of `checks.yml` (`CODING_STANDARDS.md` Rule 6.4).

## 1. Current baseline and runtime mismatch

| Target | Current state | Observation source |
| --- | --- | --- |
| Local Node runtime | `v24.22.1` (V8 `13.6.233.17-node.58`, Undici `7.30.1`) | Local `node -v` and `process.versions` check |
| `package.json` engines | No `engines` or `packageManager` field | `package.json:1-28` |
| `checks.yml` runner & Node | `ubuntu-26.04` (runner `2.338.2`), `node-version: 22` (`v22.23.4`) | `.github/workflows/checks.yml:13-18`, run `44642498287` |
| `checks.yml` actions | `actions/checkout@v4`, `actions/setup-node@v4` (both `using: node20`) | `.github/workflows/checks.yml:15-16`, upstream `action.yml` at `v4` |
| `issue-close-guard.yml` action | `actions/github-script@v7` (`using: node20`) | `.github/workflows/issue-close-guard.yml:15`, upstream `action.yml` at `v7` |
| Biome & test suite on Node 24 | `biome check .` (93 files, 1.25s); `npm test` (178 pass, 21.97s / 23.16s wall) | Local runs on `node v24.22.1`, `@biomejs/biome` `2.6.4` |

GitHub's Node 20 deprecation timeline ([GitHub Changelog, 19 September 2025, updated through 25 August 2026](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)):

- Node 20 reached EOL in April 2026 (30 April 2026 per `nodejs/Release` `schedule.json`).
- Runners switched JavaScript actions to Node 24 by default on 16 June 2026.
- Node 20 was removed from GitHub Actions runners on 23 September 2026. Both `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` (early opt-in) and `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` (temporary opt-out) are now obsolete on hosted runners because Node 20 is gone.

Live CI logs confirm the mismatch is already active:

- `checks.yml` run `44642498287` (20 November 2026) logs: `##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4.` It also prints `(node:2240) [DEP0040] DeprecationWarning: The punycode module is deprecated` and `(node:2538) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized` from the forced Node 24 action runtime.
- `issue-close-guard.yml` run `44490047637` (19 November 2026) logs the same `##[warning]` forcing `actions/github-script@v7` onto Node 24.

Node release dates from `nodejs/Release` `schedule.json`:

- Node 22 (`Jod`): Active LTS 29 October 2024, Maintenance 21 October 2025, EOL 30 April 2027.
- Node 24 (`Krypton`): Active LTS 28 October 2025, Maintenance 20 October 2026, EOL 30 April 2028.

## 2. GitHub Actions updates for Node 24

All three official actions used in `.github/workflows/` have published major releases with `runs.using: node24` in `action.yml`. Every `node24` major requires Actions Runner `v2.327.1` or newer; GitHub-hosted runners are currently on `v2.338.2` (verified in run `44642498287` and `actions/runner` releases).

| Action | Current | Node 24 majors (latest tag, date) | `action.yml` runtime | Notable breaking changes since current |
| --- | --- | --- | --- | --- |
| `actions/checkout` | `@v4` (`node20`) | `v5` (`v5.0.0`, 11 August 2025), `v6` (`v6.0.0`, 20 November 2025), `v7` (`v7.0.1`, 20 July 2026) | `node24` | `v6`: persists creds to a separate file; `v7`: ESM migration, blocks fork PR checkouts on `pull_request_target` / `workflow_run` (not used here). |
| `actions/setup-node` | `@v4` (`node20`) | `v5` (`v5.0.0`, 4 September 2025), `v6` (`v6.0.0`, 14 October 2025), `v7` (`v7.1.0`, 8 October 2026) | `node24` | `v5`/`v6`: automatic npm caching when `packageManager` or `devEngines.packageManager` is set (disable via `package-manager-cache: false`), removes `always-auth`; `v7`: ESM migration, drops dummy `NODE_AUTH_TOKEN` export, upgrades `@actions/cache` to `6.2.0`, adds `cache-primary-key`/`cache-matched-key` outputs. |
| `actions/github-script` | `@v7` (`node20`) | `v8` (`v8`, 4 September 2025), `v9` (`v9.0.0`, 9 April 2026) | `node24` | `v9`: upgrades to ESM-only `@actions/github` v9 and `@octokit/core` v7; `require('@actions/github')` fails (use injected `getOctokit`), and `const`/`let getOctokit` throws `SyntaxError`. |

Compatibility notes verified against repo workflow files:

1. **`.github/workflows/checks.yml`**:
   - Floating major tags `v5`, `v6`, `v7` exist on both `actions/checkout` and `actions/setup-node` (verified via `git/matching-refs/tags/v`).
   - `checks.yml:19` already passes `cache: npm`, so `setup-node@v6`/`v7`'s automatic `packageManager` caching behaviour does not alter caching unless `cache: npm` is removed.
   - `setup-node@v7` `node-version-file: package.json` reads `volta.node`, `devEngines.runtime`, or `engines.node` (`actions/setup-node` `src/util.ts:42-44`). Keeping `node-version: 24` explicit in `checks.yml` (or reading `engines.node` from `package.json`) installs Node 24.x (`24.x` resolves the latest 24 release on hosted toolcache).
   - `tests/repo_rules.test.mjs:479-489` and `594-611` assert that `checks.yml` includes `npm run check:lint` and excludes `check:help-popovers` and `check:layout`. `checks.yml` uses `npm run check:lint` (`biome check .`). Note `biome ci .` behaves identically for read-only CI checks without modifying files, but `repo_rules.test.mjs:469-472` pins `package.json` `scripts["check:lint"]` to `"biome check ."`.
2. **`.github/workflows/issue-close-guard.yml`**:
   - Lines 17-36 only use injected `context` and `github.rest.issues.{createComment, update}`. The inline script never calls `require('@actions/github')` and never declares `getOctokit`, so it has no `@v9` breaking-change conflict in source (untested in CI).
   - Floating major tags `v8` and `v9` exist on `actions/github-script`.

## 3. Inventory of `scripts/` and Node 24 opportunities

All 11 files in `scripts/` already use ESM (`.mjs` under `"type": "module"` in `package.json:6`) and `node:`-prefixed builtins (satisfying Biome's recommended `useNodejsImportProtocol` rule).

| File (lines) | Role | Current Node patterns | Node 24 findings / opportunities | Constraints / tests |
| --- | --- | --- | --- | --- |
| `scripts/browser_engines.mjs` (246) | Resolve Chromium/Firefox/WebKit paths, plan cache cleanup | `createRequire(import.meta.url)` solely for `require.resolve("playwright-core/package.json")` (`:10,173,177`) | `import.meta.resolve("playwright-core/package.json")` works synchronously without `node:module`; Stability 1 (Experimental) vs `createRequire` Stability 2 | `tests/browser_engines.test.mjs` |
| `scripts/browser_harness.mjs` (63) | Local static HTTP server and Playwright boot helpers | `fileURLToPath(import.meta.url)` for `ROOT` (`:4,6`); `node:fs/promises`, `node:http` | `import.meta.dirname` replaces `path.dirname(fileURLToPath(import.meta.url))` and drops `node:url` | `docs/agents/browser-verification.md` |
| `scripts/browsers.mjs` (76) | CLI for `check:browsers` and `clean:browsers` | Manual `process.argv.slice(2)` and `args.includes("--yes")` (`:68-76`); top-level execution | `util.parseArgs` for `--yes`; `import.meta.main` guard if ever imported | `tests/browser_engines.test.mjs:205-286` spawns as CLI |
| `scripts/bump_version.mjs` (98) | 7-location CalVer bumper | `fileURLToPath(import.meta.url)` for `ROOT` (`:4,6`) and entry-point guard (`:91`) | `import.meta.dirname` + `import.meta.main` drop `node:url` import | `tests/repo_rules.test.mjs:23-72`, `tests/spa_boot_and_play.test.mjs:6` |
| `scripts/check_help_popovers.mjs` (448) | Release gate: CDP popover geometry & keyboard check | Global `WebSocket` (`:61`, stable since `v22.4.0`), global `fetch` (`:428,439`, stable since `v21.0.0`); no main guard | Proxy hazard if global `NODE_USE_ENV_PROXY=1` + `HTTP_PROXY` lacks `NO_PROXY=127.0.0.1` (`fetch` to `http://127.0.0.1`); optional `import.meta.main` | Release-only gate (`CODING_STANDARDS` Rule 6.4) |
| `scripts/check_layout.mjs` (185) | Release gate: Playwright Chromium viewport & footer lock | `playwright-core`, `node:assert/strict`; no main guard | Optional `import.meta.main` guard | Release-only gate (`CODING_STANDARDS` Rule 6.4) |
| `scripts/close_issue.mjs` (115) | `issue:close` DoD checklist gate | `pathToFileURL(process.argv[1]).href` (`:7,113`), manual `parseArgs` (`:53-74`), `Atomics.wait` sync sleep (`:28-30`) | `import.meta.main` drops `node:url`; `util.parseArgs` replaces manual flag loop; `Atomics.wait` stays unless `gh()`/`main()` become async with `node:timers/promises` | `tests/issue_close_guard.test.mjs` imports `auditChecklist`, `isTransientGhError` |
| `scripts/deploy.mjs` (89) | Release preflight + `git push fork main` | `fileURLToPath` (`:5,7,82`), `execSync` with string interpolation (`:18,73`) | `import.meta.dirname` + `import.meta.main` drop `node:url`; `execFileSync` would avoid shell spawn but changes injected `exec(cmd)` seam | `tests/repo_rules.test.mjs:74-217,480-488,596-600` mocks `exec(cmd)` strings |
| `scripts/install_hooks.mjs` (158) | Installs `.git/hooks/pre-commit` and `commit-msg` | ``import.meta.url === `file://${path.resolve(process.argv[1])}` `` (`:156`); `/bin/sh` calling `node --input-type=module` | `import.meta.main` fixes line 156 (string template breaks on paths with spaces or `#`/`%`); hook shell scripts stay POSIX sh | `tests/repo_rules.test.mjs:430-592` |
| `scripts/verify_deploy.mjs` (141) | Polls Pages workflow, fetches `src/version.js`, pushes `deploy-v<CalVer>` | `fileURLToPath` (`:7,9,136`); mutates `process.env.NODE_USE_ENV_PROXY = "1"` at runtime (`:64-72`) | **Bug:** runtime `NODE_USE_ENV_PROXY` mutation is ignored by `fetch()`; fix with `http.setGlobalProxyFromEnv()` (`v24.14.0`) or `--use-env-proxy`; also `import.meta.dirname` + `import.meta.main` | `tests/repo_rules.test.mjs:812-921` asserts `process.env.NODE_USE_ENV_PROXY === "1"` |
| `scripts/worktree.mjs` (101) | Git worktree + `node_modules` entry symlinker | `fileURLToPath` (`:9,11,99`); symlinks `node_modules/*` | `import.meta.dirname` + `import.meta.main` drop `node:url` | `tests/repo_rules.test.mjs:697-755` |

## 4. Deep dive on key Node 24 behaviours (verified locally on `v24.22.1`)

### 4.1 Built-in proxy support and the `verify_deploy.mjs` bug

Node.js v24 documentation (`cli.json`, `http.json`) defines three built-in proxy mechanisms:

1. `NODE_USE_ENV_PROXY=1` (added `v24.0.0`, Stability 1 Experimental): documented as parsing `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` **during startup**.
2. `--use-env-proxy` CLI flag (added `v24.5.0`, Stability 1 Experimental): startup equivalent of `NODE_USE_ENV_PROXY=1`; takes precedence if both are set.
3. `http.setGlobalProxyFromEnv([proxyEnv])` (added `v24.14.0`): configures both `http`/`https` global agents and `fetch()`'s global dispatcher dynamically at runtime, and returns a `restore()` function.

Empirical checks on `node v24.22.1`:

- **Runtime mutation fails:** Unsetting `NODE_USE_ENV_PROXY` before launch, then setting `process.env.HTTPS_PROXY = "http://127.0.0.1:59999"` and `process.env.NODE_USE_ENV_PROXY = "1"` inside JS caused `await fetch("https://127.0.0.1:59998/")` to fail with `ECONNREFUSED 127.0.0.1:59998` (direct connection, bypassing the proxy). This means `scripts/verify_deploy.mjs:64-72` currently has no effect when invoked via `npm run deploy:verify` unless `NODE_USE_ENV_PROXY=1` is already set in the parent shell (which explains the workaround documented in `.projectmem/`). The unit test in `tests/repo_rules.test.mjs:892-917` did not catch this because it mocked `fetchImpl` and only asserted `process.env.NODE_USE_ENV_PROXY === "1"`.
- **Startup env/flag and `setGlobalProxyFromEnv()` both work:** Passing `NODE_USE_ENV_PROXY=1` at launch or calling `http.setGlobalProxyFromEnv({ https_proxy: "http://127.0.0.1:59999" })` in JS caused `fetch("https://127.0.0.1:59998/")` to fail with `ECONNREFUSED 127.0.0.1:59999` (routed via proxy).
- **Localhost hazard:** With `NODE_USE_ENV_PROXY=1` and `HTTP_PROXY=http://127.0.0.1:59999` set without `NO_PROXY`, `fetch("http://127.0.0.1:59998/")` also routed to `59999` instead of connecting directly. Setting `NODE_USE_ENV_PROXY=1` globally in CI or shells without `NO_PROXY=127.0.0.1,localhost` would break local DevTools HTTP calls in `scripts/check_help_popovers.mjs:428,439`. Scoping `http.setGlobalProxyFromEnv()` inside `verifyDeploy()` with `restore()` in a `finally` block (or passing `--use-env-proxy` only on `package.json` `deploy:verify`) avoids that hazard.

### 4.2 `import.meta.dirname`, `import.meta.main` and `import.meta.resolve`

- **`import.meta.dirname` and `import.meta.filename`**: Added in `v21.2.0` / `v20.11.0`, promoted to non-experimental in **`v24.0.0`** (`esm.json`, PR #58011). Only present on `file:` modules. Replaces `path.dirname(fileURLToPath(import.meta.url))` in `browser_harness.mjs`, `bump_version.mjs`, `deploy.mjs`, `verify_deploy.mjs` and `worktree.mjs`.
- **`import.meta.main`**: Added in **`v24.2.0`** (`esm.json`). Evaluates to `true` when the module is the process entry point and `false` when imported. Tested locally on `v24.22.1`: returns `true` both when executed directly and when executed via a symlink (`fs.symlinkSync`), and `false` when imported from another module. Replaces all six custom guards in `scripts/` (notably `install_hooks.mjs:156`, whose `` `file://${path.resolve(process.argv[1])}` `` fails if the repo path contains spaces or percent-encoded characters).
- **`import.meta.resolve`**: Synchronous since `v20.0.0`, unflagged since `v20.6.0`, still marked Stability 1 (Experimental) in `esm.json`. Verified locally on `v24.22.1`: `import.meta.resolve("playwright-core/package.json")` resolves cleanly both from `/root/C64_music` and from a temporary worktree whose `node_modules/playwright-core` is a symlink (matching `scripts/worktree.mjs:30`). Removing `createRequire` from `scripts/browser_engines.mjs` trades Stability 2 (`createRequire`) for Stability 1 (`import.meta.resolve`).
- **Biome compatibility**: `@biomejs/biome` `2.6.4` parses `import.meta.dirname`, `import.meta.main` and `http.setGlobalProxyFromEnv` with zero lint diagnostics.

### 4.3 `util.parseArgs`, `fs.glob`, `--run`, TypeScript stripping and `node --test`

- **`util.parseArgs` (`node:util`)**: Stable since `v20.0.0`; negative options (`allowNegative`) added `v22.4.0`. Fits `scripts/close_issue.mjs:53-74` (positional issue number plus `--comment`, `--comment-file`, `--allow-no-checklist`, `--dry-run`) and `scripts/browsers.mjs:68-76` (`--yes`). Verified locally on `v24.22.1` with mixed positional + flag arguments.
- **`fs.glob` / `fsPromises.glob`**: Marked stable in **`v24.0.0`** (`fs.json`, PR #57513). No `scripts/` file currently shells out or walks directories by glob (`browser_engines.mjs` scans one cache level with `readdirSync`), so there is no immediate call site in `scripts/`.
- **`node --run` (`cli.json`)**: Added `v22.0.0`; listing scripts when invoked with no script name added `v24.22.0`. Faster than `npm run` for manual/agent script invocation, though `npm run` remains standard in `package.json` docs, `deploy.mjs`, `install_hooks.mjs`, and `tests/repo_rules.test.mjs`.
- **Type stripping (`--no-strip-types`)**: Enabled by default in `v23.6.0` / `v22.18.0`, marked stable in `v24.12.0`. Unused here because the project intentionally writes plain JavaScript (`AGENTS.md`).
- **`node --test` (`test.json`, `cli.json`)**: Stable since `v20.0.0`. Node 24 adds `--test-global-setup` (`v24.0.0`), `run({ env })` and expecting tests to fail (`v24.14.0`), randomised execution order (`v24.16.0`), and test tags (`v24.19.0`). Local `npm test` (`node --test tests/*.test.mjs`) already executes all 178 tests in 21.97s on `v24.22.1`, and `scripts/install_hooks.mjs:50,69` explicitly passes staged `$TEST_FILES` to `node --test`, so changing `package.json` `scripts.test` is unnecessary.

## 5. Options and tradeoffs (for `/grill-with-docs`)

| Option | Scope | Node floor | Tradeoffs |
| --- | --- | --- | --- |
| **A. CI + proxy bugfix (minimal)** | Update `.github/workflows/checks.yml` (`checkout@v7`, `setup-node@v7`, `node-version: 24`) and `issue-close-guard.yml` (`github-script@v9`); add `engines.node` to `package.json`; fix `verify_deploy.mjs` proxy handling (`http.setGlobalProxyFromEnv()` with `restore()`, or `node --use-env-proxy` in `package.json`) | `>=24.14.0` (if `setGlobalProxyFromEnv`) or `>=24.5.0` (if `--use-env-proxy`) | Eliminates GitHub Actions Node 20 deprecation warnings, aligns CI with local Node 24, fixes live proxy bug in `verify_deploy.mjs`. Minimal diff; `tests/repo_rules.test.mjs:900` needs updating if `process.env.NODE_USE_ENV_PROXY` mutation is removed. |
| **B. Full Node 24 script modernisation** | Option A + adopt `import.meta.dirname` (5 scripts), `import.meta.main` (6-9 scripts), `util.parseArgs` (`close_issue.mjs`, `browsers.mjs`), optionally `import.meta.resolve` (`browser_engines.mjs`) | `>=24.14.0` | Drops boilerplate `node:url` imports and fixes `install_hooks.mjs` path-encoding edge case. Larger diff; `import.meta.resolve` remains Stability 1; converting `deploy.mjs` `execSync` to `execFileSync` would require updating `tests/repo_rules.test.mjs:75-200`. |
| **C. CI caching / `node-version-file` polish** | Set `packageManager` (or `devEngines.packageManager`) in `package.json` for `setup-node@v7` auto-cache, or point `node-version-file: package.json` at `engines.node` | `>=24` | Single source of truth for Node version between `package.json` and `checks.yml`, at the cost of maintaining `packageManager` pin if added (`npm` version drift) vs keeping simple `node-version: 24` and `cache: npm`. |

## 6. Not verified in CI or live deploy

- Running `.github/workflows/checks.yml` on GitHub Actions with `actions/checkout@v7`, `actions/setup-node@v7` and `node-version: 24`.
- Running `.github/workflows/issue-close-guard.yml` with `actions/github-script@v9` against a real `issues` `closed` event.
- Running `npm run deploy:verify` end-to-end against `https://charlesroper.github.io/C64_music/src/version.js` through a real HTTP/HTTPS proxy using `http.setGlobalProxyFromEnv()` or `--use-env-proxy`.
- Behaviour of `scripts/check_help_popovers.mjs` and `scripts/check_layout.mjs` (both are release-only Chromium gates; neither was run in this research pass).
