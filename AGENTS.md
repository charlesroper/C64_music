# Agent guidelines for the Galway 2664 C64 music workbench

Keep always-loaded guidance minimal. Detailed engineering and review rules live in `CODING_STANDARDS.md`; deterministic checks run in `npm test`, `npm run check:lint`, `.git/hooks/` and `.github/workflows/checks.yml`.

## 1. Versioning and deployment (CalVer)

Run `npm run bump` before every release (`node scripts/bump_version.mjs YYYY.MM.DD` for an explicit version). Same-day releases append `.1`, `.2`, `.3`. See `CODING_STANDARDS.md` Section 5 for all seven synchronised version locations enforced by `npm test`.

## 2. Historical source integrity

Implement fixes and catalogue adjustments in `src/` or `src/tracks_catalog.js`. Never edit Galway's seven original `.asm`/`.txt` files; `npm test` verifies their SHA-256 checksums.

## 3. Style and prose rules

Before editing `README.md`, `NARRATIVE.md`, UI copy or catalogue descriptions, read `docs/agents/prose-and-narrative.md` for drafting stages, the sub-editor gate, house rules and narrative layout. Avoid literal em-dashes (U+2014) everywhere; `npm test` rejects them.

## 4. Documentation and test suite synchronisation

Reflect behaviour-changing edits in both `README.md` and `NARRATIVE.md` (pixel/spacing fixes exempt), keeping test counts and lists matching `npm test`. For story-changing events, append a `NARRATIVE.md` Section 8 entry without a hash, commit it, then add the short hash in a follow-up `Record ... commit` commit (zero `[HASH]` placeholders). See `CODING_STANDARDS.md` Section 7.

Run `npm test` and `npm run check:lint` before committing.

## 5. Commit standards

Follow Chris Beams' rules (<=50-char capitalised imperative subject, no trailing period, blank line, 72-col wrapped body, issue reference when present). See `CODING_STANDARDS.md` Section 8; enforced locally by the `commit-msg` hook (`npm run hooks:install`).

## 6. GitHub Pages deployment

When asked to deploy or publish, follow `docs/agents/deployment.md`. Tag `deploy-v<CalVer>` on `fork` after deploy; create `known-good-v<CalVer>` only after user confirmation.

## 7. Bug fixes start with a failing check

Add a failing test or repeatable visual check before writing fix code, run it red against baseline, then make it pass. See `CODING_STANDARDS.md` Rule 9.1.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `charlesroper/C64_music`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

Close an issue only with `npm run issue:close -- <number> --comment "..."`. The guard refuses unchecked DoD or acceptance criteria, and a workflow reopens any completed issue closed with unchecked items. Do not call `gh issue close` directly.

### Triage labels

The five canonical triage roles map to their own names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Browser verification

Read `docs/agents/browser-verification.md` before running headless browser checks. It records the engine matrix, per-host constraints and screenshot locations.
