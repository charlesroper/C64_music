# Agent Guidelines for Galway 64 C64 Music Workbench

Instructions and conventions for AI coding agents working in this repository.

## 1. Versioning and Deployment (CalVer)

Every deployment must update the calendar version across three synchronized files:
- `package.json`: `"version": "YYYY.MM.DD"` (or `"YYYY.MM.DD.MICRO"`).
- `index.html`:
  - Document title: `<title>Galway 64 // Ocean 6502-SID Workbench (1985-1987) vYYYY.MM.DD</title>`.
  - Header badge: `<span class="brand-version" id="app-version">vYYYY.MM.DD</span>` placed immediately following the app title inside `<div class="brand-title">`.
- `src/version.js`: `export const APP_VERSION = "YYYY.MM.DD";`.

### Same-Day Updates
When multiple updates deploy on the same calendar day, append a sequential increment (`.1`, `.2`, `.3`):
- First release: `2026.10.30`
- Second release: `2026.10.30.1`
- Third release: `2026.10.30.2`
- Next day: reset to `YYYY.MM.DD` for the new date.

### Automated Version Bumping
Run `npm run bump` (or `node scripts/bump_version.mjs`) to update all three files automatically:
- If today's UTC date matches the current version, it appends or increments the `.MICRO` counter.
- On a new calendar day, it resets to `YYYY.MM.DD`.
- To set an explicit version: `node scripts/bump_version.mjs YYYY.MM.DD`.

## 2. Historical Source Code Integrity

Martin Galway's original assembly source files must remain authentic and unmodified:
- `wizball.asm`
- `arkanoid.asm`
- `arkadrum.asm`
- `gameover.asm`
- `greenberet.asm`
- `rambload.asm`
- `ocean_assembler_directives.txt`

Never edit, reformat, or patch these historical files. All catalog corrections, bug fixes, and emulator adjustments belong in the emulator, web driver (`src/`), or catalog metadata (`src/tracks_catalog.js`).

## 3. Style and Prose Rules

- **No em-dashes**: Do not use em-dash characters (Unicode U+2014) anywhere in this repository (markdown, code comments, commit messages, or HTML). Use commas, colons, parentheses, or periods instead.
- **William Zinsser prose**: Keep documentation concise, active, and direct. Avoid marketing hype, jargon, and fluff.

## 4. Documentation and Test Suite Synchronization

- **Dual-document updates**: Every feature, UI change, workflow script, or catalog adjustment must be reflected in both `README.md` and `NARRATIVE.md` in lockstep:
  - `README.md`: Technical setup, architecture overview, capabilities, and developer workflow.
  - `NARRATIVE.md`: In-app story overlay covering visible player UI elements (Section 3), architecture (Section 5), and verification (Section 7).
- **Test synchronization**: Run `npm test` before committing. All tests must pass. When adding, modifying, or removing tests, update the test counts and bulleted check lists in both `README.md` and `NARRATIVE.md` to match `npm test` exactly.

## 5. Commit Standards

Follow Chris Beams' git commit message guidelines:
- Separate subject from body with a blank line.
- Limit subject line to 50 characters, capitalized, imperative mood ("Add...", "Fix...", "Update..."), no trailing period.
- Wrap body text at 72 characters.

## 6. GitHub Pages Deployment ("Ship it" / "Deploy")

When the user says "ship it", "deploy", or asks to publish, deploy to GitHub Pages:

### Deployment Target
- **Remote & Branch**: Push to `fork main` (`git push fork main`).
- **Live URL**: `https://charlesroper.github.io/C64_music/`
- **Hosting**: GitHub Pages serves directly from the root `/` of `main` on `fork`.

### Quick Command
Run:
```bash
npm run deploy
```
This runs the full test suite (`npm test`) and pushes to `fork/main`.

### Deployment Checklist
1. **CalVer Bumping**: Run `npm run bump` to update `package.json`, `index.html`, and `src/version.js`.
2. **Docs & Test Sync**: Verify all tests pass (`npm test`) and test counts match in `README.md` and `NARRATIVE.md`.
3. **Commit**: Commit changes following Chris Beams standards (Section 5).
4. **Deploy**: Run `npm run deploy` (or `git push fork main`).
5. **Verification**: Confirm the build at `gh api repos/charlesroper/C64_music/pages/builds/latest` or curl `https://charlesroper.github.io/C64_music/`. Report the live URL, CalVer version, and commit hash.
