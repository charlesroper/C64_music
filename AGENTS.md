# Agent guidelines for the Galway 2664 C64 music workbench

## 1. Versioning and deployment (CalVer)

Every deployment updates the calendar version in seven synchronised places:
- `package.json`: `"version": "YYYY.MM.DD"` or `"YYYY.MM.DD.MICRO"`.
- `package-lock.json`: root `"version": "YYYY.MM.DD"`.
- `index.html` document title: `<title>Galway 2664 // Ocean 6502-SID Workbench (1985-1987) vYYYY.MM.DD</title>`.
- `index.html` header badge: `<span class="brand-version" id="app-version">vYYYY.MM.DD</span>` next to the app title inside `<div class="brand-title">`.
- `index.html` stylesheet query string: `href="./src/styles.css?v=YYYY.MM.DD"`.
- `index.html` script query string: `src="./src/main.js?v=YYYY.MM.DD"`.
- `src/version.js`: `export const APP_VERSION = "YYYY.MM.DD";`.

Run `npm run bump` to update all seven places. If today's UTC date matches the current version, it appends or increments the `.MICRO` counter. On a new day it resets to `YYYY.MM.DD`. To set an explicit version, run `node scripts/bump_version.mjs YYYY.MM.DD`.

Same-day releases append `.1`, `.2`, `.3`. Completion: every listed location shows the same version and `npm test` passes.

## 2. Historical source integrity

Keep Galway's original files byte-identical to upstream:
- `wizball.asm`
- `arkanoid.asm`
- `arkadrum.asm`
- `gameover.asm`
- `greenberet.asm`
- `rambload.asm`
- `ocean_assembler_directives.txt`

Implement catalogue fixes, bug fixes and timing changes in `src/` or `src/tracks_catalog.js`. Completion: `npm test` verifies the SHA-256 checksums of all seven files.

## 3. Style and prose rules

Write for the surface. Run Stage 1 before drafting, then the Stage 2 sub-editor gate before delivery.

Before editing `README.md`, `NARRATIVE.md`, UI copy or catalogue descriptions, read `docs/agents/prose-and-narrative.md`. It carries the drafting skills, the sub-editor gate, the house rules and the eight-section narrative layout.

Completion: the edited prose passes the repository rules test, with zero em-dashes and no broken Markdown rendering.

## 4. Documentation and test suite synchronisation

Reflect every feature, UI change, workflow script, bug fix or catalogue adjustment in both `README.md` and `NARRATIVE.md`:
- `README.md`: technical setup, architecture, capabilities and developer workflow.
- `NARRATIVE.md`: the in-app story overlay, including Sections 3, 5, 7 and 8.

Append a dated entry (`### DD Month YYYY: title`) to `NARRATIVE.md` Section 8 for every story-changing event: a new feature, significant bug fix, architectural seam, performance optimisation or notable failure or reversal. Explain the problem, the change, how it was verified and link commit hashes, issues and ADRs. Skip routine chores such as typo fixes, CalVer bumps, formatting and dependency updates.

A Section 8 entry cannot know its own commit hash. Commit the entry without a commit link, then add the short hash in a follow-up `Record ... commit` commit. The suite rejects a `[HASH]` placeholder.

Run `npm test` before committing. When tests change, update the test counts and bulleted check lists in both `README.md` and `NARRATIVE.md` to match `npm test` exactly. Completion: both documents state the same test count as the suite.

## 5. Commit standards

Follow Chris Beams' git commit message guidelines:
- Separate the subject from the body with a blank line.
- Limit the subject to 50 characters, capitalised, imperative mood, with no trailing full stop.
- Wrap body text at 72 characters.
- Reference the originating issue in the body when one exists, for example `Issue #90`.

Completion: `git log -1` shows a compliant subject and body.

## 6. GitHub Pages deployment

When the user says "ship it", "deploy" or asks to publish, follow `docs/agents/deployment.md`. It carries the remotes, release sequence, live-build verification and tag rules.

### Release tags

- After a successful deploy, tag the commit `deploy-v<CalVer>` and push it to `fork`.
- Create `known-good-v<CalVer>` only after the user confirms the live build is good. Never create it automatically.

## 7. Search tooling

Use the agent harness's built-in content search and file discovery tools when they exist. They are permission-aware and usually return structured results. Many harnesses already back content search with ripgrep. If the harness has no built-in search tools, use shell `rg` and `fd`.

Use shell `rg` only when the built-in search lacks a needed flag, such as `--type`, `-uu` or multiline search.

Use shell `fd` only when the built-in file discovery lacks a needed filter, such as `--type`, `--changed-within`, `--exclude` or `--exec`. On Debian, `fd` may be installed as `fdfind`.

Do not run shell `grep` or `find` merely to get output compression. Where RTK is wired, it rewrites shell commands, not built-in tools.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `charlesroper/C64_music`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

Close an issue only with `npm run issue:close -- <number> --comment "..."`. The guard refuses unchecked DoD or acceptance criteria, and a workflow reopens any completed issue closed with unchecked items. Do not call `gh issue close` directly.

### Triage labels

The five canonical triage roles map to their own names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Browser verification

Read `docs/agents/browser-verification.md` before running headless browser checks. Use WebKit or Chromium 153 for worklet verification, and Firefox for UI checks only.
