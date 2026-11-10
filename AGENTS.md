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

Read the relevant skill before editing:
- Prose, UI copy or catalogue descriptions: `.agents/skills/guardian-style-guide/SKILL.md` and `.agents/skills/on-writing-well/SKILL.md`, including `references/tropes.md`.
- `NARRATIVE.md`: `.agents/skills/project-narrative/SKILL.md`.
- Commit messages: `.agents/skills/cbeams-git-commit-messages/SKILL.md`.
- `AGENTS.md`: `.agents/skills/writing-for-agents/SKILL.md`.

Apply Guardian British English and Zinsser clarity:
- Use `licence` as a noun and `licensed` as a verb. Use `catalogue`, `analogue`, `colour`, `centre`, `artefact`, `modelled`, `labelled`, `focused`, `synthesise`, `synthesiser`, `digitised`, `synchronise`, `synchronisation` and `program` for computer code.
- Use sentence case for headings, tooltips and descriptive labels.
- Omit Oxford commas in straightforward lists. End every bullet with a full stop. Avoid exclamation marks.
- Spell out one to nine in general prose. Use numerals from 10 upward and with units.
- Leave no space before abbreviated units: `50Hz`, `200Hz`, `44.1kHz`, `1.023MHz`, `20ms`, `40px`. Use a space before spelled-out units: `40 pixels`.
- Format dates as `23 April 1987` and times as `4.31pm`.
- Use commas, colons, parentheses or full stops for pauses. Never use em-dashes (U+2014). En-dashes (U+2013) are allowed in Markdown prose.
- Use backticks around code identifiers and registers such as `$D400` and `requestAnimationFrame`. Use `->` rather than arrow glyphs.
- Keep active voice, concrete verbs and one controlling idea per sentence. Remove brochure adjectives and AI tropes.
- Prioritise scannability in technical documentation (`README.md`, developer guides and reference lists). Use bold lead-in tags on reference items, numbered steps with action verbs and fenced syntax blocks for before and after code. These visual scannability conventions override general essay anti-bullet-bolding rules.

`NARRATIVE.md` powers the in-app THE STORY modal. Keep its eight-section progressive layout:
- Sections 1 to 3 orient non-technical listeners with no assumed 6502 knowledge.
- Sections 4 to 8 move into hardware, assembly and build detail.
- Do not replace the layout with the nine-section template in `project-narrative`.
- Keep Martin Galway's quotations verbatim.
- Respect `src/markdown.js`: full `https://` URLs only, `#`, `##` and `###` headings only, single-line unwrapped paragraphs and code spans around `*` expressions.

Completion: the edited prose passes the repository rules test, with zero em-dashes and no broken Markdown rendering.

## 4. Documentation and test suite synchronisation

Reflect every feature, UI change, workflow script, bug fix or catalogue adjustment in both `README.md` and `NARRATIVE.md`:
- `README.md`: technical setup, architecture, capabilities and developer workflow.
- `NARRATIVE.md`: the in-app story overlay, including Sections 3, 5, 7 and 8.

Append a dated entry (`### DD Month YYYY: title`) to `NARRATIVE.md` Section 8 for every story-changing event: a new feature, significant bug fix, architectural seam, performance optimisation or notable failure or reversal. Explain the problem, the change, how it was verified and link commit hashes, issues and ADRs. Skip routine chores such as typo fixes, CalVer bumps, formatting and dependency updates.

Run `npm test` before committing. When tests change, update the test counts and bulleted check lists in both `README.md` and `NARRATIVE.md` to match `npm test` exactly. Completion: both documents state the same test count as the suite.

## 5. Commit standards

Follow Chris Beams' git commit message guidelines:
- Separate the subject from the body with a blank line.
- Limit the subject to 50 characters, capitalised, imperative mood, with no trailing full stop.
- Wrap body text at 72 characters.

Completion: `git log -1` shows a compliant subject and body.

## 6. GitHub Pages deployment

When the user says "ship it", "deploy" or asks to publish, release to GitHub Pages.

Repository remotes:
- `origin` points to upstream `MartinGalway/C64_music`.
- `fork` points to `charlesroper/C64_music`.
- Pass `-R charlesroper/C64_music` to every `gh` command.
- Push releases only to `fork main`.
- Live URL: `https://charlesroper.github.io/C64_music/`.
- GitHub Pages serves the root `/` of `main` on `fork`.

Release sequence:
1. Run `npm run bump`. Completion: all seven version locations show the new CalVer.
2. Run `npm test`. Completion: every check passes and the documented test counts match.
3. Commit the release. Completion: the working tree is clean.
4. Run `npm run deploy`. Completion: the push succeeds on `fork/main`.
5. Verify the live build with `gh api repos/charlesroper/C64_music/pages/builds/latest` or `curl https://charlesroper.github.io/C64_music/`. Completion: report the live URL, CalVer version and commit hash.

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
