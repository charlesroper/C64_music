# Playwright CLI for agent-driven browser checks

Research note, 19 November 2026. It asks whether this project can use `@playwright/cli`, and separates what primary sources confirm from what is untested. The note proposes no production change.

Sources: the package's README and tarball (https://github.com/microsoft/playwright-cli, https://registry.npmjs.org/@playwright/cli/-/cli-0.1.25.tgz), npm registry metadata (https://registry.npmjs.org/@playwright/cli), the installed `node_modules/playwright-core` 1.65.0 source, and this repo's own files. I did not run the CLI. Every behaviour claim below comes from reading source or documentation.

## Summary

- `@playwright/cli` is a command-line browser driver built for coding agents. It is not a test runner.
- The project can use it, but it should not add it as a dependency. The package pins the full `playwright` package and an alpha `playwright-core`, which conflicts with the rule in `docs/agents/browser-verification.md` that ad-hoc scripts import `playwright-core`, never `playwright`.
- The CLI's code already ships inside `playwright-core` 1.65.0, so a trial needs no new dependency. This is read from source and untested.
- Its defaults do not match the PRoot host. A project config file fixes that.
- It cannot replace `npm test`, `check:layout`, `check:help-popovers` or `check:browsers`.

## 1. What it is

`@playwright/cli` 0.1.25 was published on 18 November 2026 by Microsoft's GitHub Actions publisher. It is Apache-2.0, needs Node 20 or newer, and exposes one binary, `playwright-cli` ([npm metadata](https://registry.npmjs.org/@playwright/cli/latest)). `latest` is 0.1.25 and the registry lists 34 versions, all 0.x ([registry](https://registry.npmjs.org/@playwright/cli)). It is pre-1.0, so expect the command set to change.

The README describes it as "Playwright CLI with SKILLS" for coding agents, and says CLI commands are more token-efficient than MCP because they avoid large tool schemas and verbose accessibility trees ([README](https://github.com/microsoft/playwright-cli/blob/main/README.md)).

What it does, per the README:

- **Sessions.** `open [url]` starts a browser that a background daemon keeps alive, so later commands reuse it. Pass `-s=name` for a named session. `list`, `close-all` and `kill-all` manage them. The profile lives in memory unless `--persistent` or `--profile=<path>` is given. A headless session stops after an hour idle; `--idle-timeout=<ms>` changes that.
- **Snapshots and refs.** `snapshot` returns an accessibility tree with element refs such as `e21`. `click`, `fill`, `check` and others take a ref, a CSS selector, a role locator or a test id. `find` searches a snapshot.
- **Page state.** `eval <func>` evaluates JavaScript in the page. `run-code` runs a Playwright snippet that receives `page`. `console` and `requests` list console messages and network requests.
- **Artefacts.** `screenshot` (`--filename`, `--hires`), `pdf`, `tracing-start` and `tracing-stop`, `video-start` and `video-stop`, `recording-start` and `recording-stop`, `generate-locator`.
- **Emulation.** `resize`, `open --mobile`, `open --device="iPhone 15"`, `set-reduced-motion`, `set-color-scheme`, `network-state-set`, `route` for request mocking.
- **Storage.** cookies, `localStorage`, `sessionStorage`, `state-save` and `state-load`.
- **Dashboard.** `show` opens a visual session dashboard.
- **Skills.** `playwright-cli install --skills` installs a `playwright-cli` skill for coding agents; `-g` installs it globally ([README](https://github.com/microsoft/playwright-cli/blob/main/README.md)). The tarball contains `skills/playwright-cli/SKILL.md` and reference guides for tracing, request mocking, running code, session management, storage state, test generation, video and PR attachments (tarball listing).

Command list verified against `node_modules/playwright-core/lib/tools/cli-client/help.json`.

### How it differs from its neighbours

| Tool | What it is | Source |
| --- | --- | --- |
| `playwright-core` | The automation library and browser launcher. No test runner. This repo imports it. | `package.json`, `scripts/browser_engines.mjs` |
| `@playwright/test` | A test runner built on the library. Not installed here. | `package.json` |
| `@playwright/cli` | Shell commands over a persistent browser, with skills for agents. | README |
| Playwright MCP | A tool server for agent loops that need persistent state and rich page introspection. | [README, "CLI vs MCP"](https://github.com/microsoft/playwright-cli/blob/main/README.md) |

## 2. Dependencies and browser handling

**Dependencies.** The 0.1.25 manifest lists exactly two runtime dependencies, `playwright` and `playwright-core`, both pinned to `1.66.0-alpha-2026-11-18` ([npm metadata](https://registry.npmjs.org/@playwright/cli/latest)). `playwright-core`'s latest tag is 1.65.1 ([registry](https://registry.npmjs.org/playwright-core)). A devDependency would therefore install the full `playwright` package, plus an alpha `playwright-core` nested beside the pinned 1.65.0.

**The CLI already lives in playwright-core.** `playwright-cli.js` imports `playwright-core/lib/tools/cli-client/program` and `playwright-core/lib/coreBundle` (tarball, `package/playwright-cli.js`). The installed `node_modules/playwright-core` 1.65.0 contains `lib/tools/cli-client/`, `lib/tools/skills/playwright-cli/` and a `cli` subcommand described as "run playwright cli commands from terminal" (`lib/coreBundle.js`, line 76718). The README says the local route is `npx playwright cli` and needs Playwright 1.59 or newer. Whether `npx playwright-core cli` works is untested.

**Browser downloads.** The package has no `postinstall` script (manifest). But `playwright-cli install` calls `ensureConfiguredBrowserInstalled()` (`coreBundle.js`, `initWorkspace`), and an `install-browser` command exists. Avoid `install` on this host.

**Browser choice.** From `coreBundle.js`, `validateBrowserConfig`:

- With no `--browser` and no config, the CLI launches Chromium with `channel: "chrome"`, meaning a system Chrome install, not Playwright's cache.
- `--browser=chromium` maps to the `chrome-for-testing` channel. `firefox` and `webkit` are accepted.
- On Linux, `chromiumSandbox` defaults to true for the `chrome` channel and false for `chromium`/`chrome-for-testing`.
- Headless is the default ([README](https://github.com/microsoft/playwright-cli/blob/main/README.md)). Headless pages get a 1280x720 viewport unless configured.

**Custom executable.** A JSON config at `.playwright/cli.config.json` loads by default, or pass `--config <file>` ([README, "Configuration file"](https://github.com/microsoft/playwright-cli/blob/main/README.md)). Its `browser.launchOptions` accepts Playwright launch options "like `channel`, `headless`, `executablePath`", and `browser.contextOptions` accepts context options. The environment variable `PLAYWRIGHT_MCP_EXECUTABLE_PATH` and a CLI executable-path option also exist (`coreBundle.js`, `resolveExtensionOptions`). `CHROME_PATH` is not read; that variable belongs to this repo's resolver. Untested: how `executablePath` interacts with the default `chrome` channel.

Unlike the repo's scripts, the CLI adds `--disable-blink-features=AutomationControlled` to Chromium launches (`validateBrowserConfig`). That is harmless here but differs from `scripts/browser_engines.mjs` launches.

## 3. Fit with this project

| Constraint | Source | Fit |
| --- | --- | --- |
| Debian under PRoot, Chromium 153 only; 156 and 158 crash with SIGTRAP | `docs/agents/browser-verification.md` | Works only if config points `executablePath` at the 153 headless shell. The default `chrome` channel would look for a system Chrome. |
| `--no-sandbox` needed | `docs/agents/browser-verification.md` | Set `launchOptions.chromiumSandbox: false` or `args: ["--no-sandbox"]` in the config. The default for the `chrome` channel is sandbox on. |
| `playwright-core` pinned, never `playwright` | `docs/agents/browser-verification.md` | A devDependency violates this. The zero-dependency route reuses the installed core. |
| Resolver owns browser paths | `scripts/browser_engines.mjs` | The CLI has no hook into `resolveBrowserEngine`. The path would be duplicated in a config file, which the guide says to avoid. |
| Static server and boot wait | `scripts/browser_harness.mjs` | The CLI does not serve files. `waitForWorkbenchReady` has no counterpart; an agent would poll with `eval`. |
| 3.4 GB RAM, one browser at a time | `docs/agents/browser-verification.md` | The CLI daemon keeps a browser alive between commands and idles for up to an hour. It adds a browser the existing scripts do not know about. |
| No audio device | `docs/agents/browser-verification.md` | Unchanged. `eval` can call `player.pullAudioBlock` and read `window.__workbenchState.player`, as the guide describes. |
| UI lockup under 6x CPU throttling (projectmem issue 0003, as recorded in session memory; not re-checked against GitHub) | `.projectmem/` | No CPU-throttle command appears in `help.json` or the README. `run-code` gives the `page` object, and Playwright can open a CDP session on it, but this is untested here. |
| Bug fixes start with a failing test or repeatable visual check | `AGENTS.md` | CLI sessions are interactive and not repeatable. `recording-stop` prints actions as Playwright code, but the repo's repeatable checks are the `scripts/check_*.mjs` files. |
| Plain JS, minimal dependencies | `AGENTS.md`, `package.json` | The package is plain JS, but it brings the full `playwright` package. |

File access: the README says file access is restricted to the workspace roots and `file://` navigation is blocked by default (environment table, `PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS`). The repo already requires HTTP over `127.0.0.1`, so this agrees.

## 4. Candidate uses and non-uses

**Plausible uses (ad-hoc, agent-run):**

- Open the workbench on a local static server, take `snapshot` and `screenshot` at phone widths with `resize`, and read the result.
- Use `eval` to read `window.__workbenchState.player` after a tap.
- Use `console` and `requests` to see load errors during boot.
- Use `set-reduced-motion` for style checks, matching `reducedMotion: "reduce"` in the guide.
- Use `tracing-start` and `tracing-stop` to capture a trace of a UI hang.

**Will not replace:**

- `npm test` (`node --test tests/*.test.mjs`), which uses the mock browser harness.
- `npm run check:layout` and `npm run check:help-popovers`, which are release gates in `scripts/deploy.mjs` with tuned pixel tolerances.
- `npm run check:browsers`, which validates engine paths and revisions.
- Any bug-fix proof. Rule 9.1 needs a failing test or a repeatable visual check, not a session transcript.

## 5. Risks and recommendation

Everything in this section is opinion.

**Risks**

- Dependency conflict. See section 2.
- Pre-1.0 churn: 34 releases in under four months, the last on 18 November 2026.
- Wrong browser by default, and a sandboxed Chrome launch that will probably fail under PRoot.
- `install` writes `.playwright/`, patches `.gitignore`, installs skills and may download a browser (`coreBundle.js`, `initWorkspace`, `patchGitIgnore`). The CLI's output lands in `.playwright-cli/`, which the CLI's own code treats as possibly containing credentials.
- The CLI's update check spawns `npm view` at most daily on `open`, `attach`, `list` and `install` unless `CI` or `NO_UPDATE_NOTIFIER` is set (tarball, `playwright-cli.js`).
- Memory: a daemon browser plus a test run could exceed 3.4 GB.
- Skills overlap with the repo's 45 skills in `.agents/skills/`, and `skills-lock.json` governs them.

**Recommendation**

1. Do not add `@playwright/cli` to `package.json`.
2. If an agent needs ad-hoc browsing, try `npx playwright-core cli` first. It reuses the pinned core and is untested.
3. Add nothing to the repo until a trial works. A trial needs a config file that sets `executablePath` (from `npm run check:browsers`) and `--no-sandbox`. Keep that file out of git, as the guide keeps device paths out.
4. Run one browser at a time. Close the session with `playwright-cli close` before `npm test` or any Chromium gate.
5. Revisit when the CLI reaches 1.0 and depends on a stable `playwright-core` the repo can pin.

## Not verified from a primary source

- That `npx playwright-core cli` runs the same commands as `playwright-cli`.
- That `executablePath` wins over the default `chrome` channel on this host.
- That the daemon starts under PRoot with Chromium 153.
- That CPU throttling can be applied through `run-code`.
- Memory use of the daemon.
- The release dates of 0.1.19 to 0.1.25 are registry `time` fields, which I read but did not cross-check.
