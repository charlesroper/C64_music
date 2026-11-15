---
status: accepted
---

# Centralised Browser Engine Resolution

Resolve Chromium, Firefox and WebKit through one module backed by a pinned `playwright-core` dependency. Keep Chromium 153 preferred on the PRoot host because later revisions crash at startup.

## Context

Headless checks previously depended on whatever Playwright copy sat in the `npx` cache and a hardcoded Chromium path. Firefox and WebKit had to be found by hand. The machine-wide Playwright cache held about 4.4GB of revisions, most of them unused.

Chromium 156 and later exit with `SIGTRAP` under PRoot, so the newest build is not a safe default on this host. On other hosts the Playwright default may be correct.

## Decision

- Pin `playwright-core`, not `playwright`. It provides engine paths without downloading browsers.
- Resolve engines through one module. Resolution order is the engine path override, the Chromium 153 headless shell when installed, the Playwright engine, then a system Chromium.
- Report the chosen source and warn when Chromium 153 is unavailable. The release gate rejects that warning because it must not launch a crashing build.
- Keep cleanup separate from resolution. A dry-run planner selects stale browser revisions; deletion needs an explicit `--yes`.
- Derive the cleanup keep set from the current host's resolved engines and the Playwright ffmpeg revision.

## Considered Options

- **Keep the `npx` cache and hardcoded paths**: rejected. Cache hashes change and the path drifts between scripts.
- **Depend on `playwright`**: rejected. The full package downloads browsers during install and duplicates the existing cache.
- **Force Chromium 153 on every host**: rejected. The crash is a PRoot constraint, not a project-wide requirement.
- **Delete old browsers by hand**: rejected. It does not scale when Playwright revisions change and cannot report what it removed.

## Consequences

- Browser scripts share one resolution order and one source of truth.
- The release gate fails when Chromium 153 is missing instead of running Chromium 156 or later.
- Other hosts can set `CHROME_PATH` to a working Chromium.
- The browser cache can be pruned to the active revisions and ffmpeg.
- The browser checks stay out of CI because they depend on local fonts and pinned browser builds.
