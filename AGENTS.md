# Agent guidelines for the Galway 2664 C64 music workbench

Keep always-loaded guidance minimal. Engineering and review rules live in `CODING_STANDARDS.md`; deterministic checks run via `tests/repo_rules.test.mjs`, `npm test`, `npm run check:lint`, `.git/hooks/`, and `.github/workflows/checks.yml`.

## Release and version workflow

- Run `npm run bump` before every release (`node scripts/bump_version.mjs YYYY.MM.DD` for an explicit date). See `CODING_STANDARDS.md` Section 5.
- For deployments, follow `docs/agents/deployment.md`. Tag `deploy-v<CalVer>` on `fork` after deploy; create `known-good-v<CalVer>` only after user confirmation.

## Project boundaries and workflow

- **Frozen historical sources:** Edit `src/` or `src/tracks_catalog.js` only; never modify Galway's seven original `.asm`/`.txt` files.
- **Prose and narrative:** Read `docs/agents/prose-and-narrative.md` before editing `README.md`, `NARRATIVE.md`, UI copy, or catalogue descriptions. Add `NARRATIVE.md` Section 8 entries only at parent-spec wrap-up or on request, linking already-committed SHAs (`CODING_STANDARDS.md` Section 7).
- **Bug fixes:** Start with a failing test or repeatable visual check before writing fix code (`CODING_STANDARDS.md` Rule 9.1).
- **Pre-commit and verification scope:** Install local hooks with `npm run hooks:install` (`CODING_STANDARDS.md` Section 8). Run `npm run check:lint` before tests. When edits touch only `tests/*.test.mjs` and docs, run the touched test file during iteration and skip baseline Chromium runs (matching `scripts/install_hooks.mjs`).

## Agent skills and pointers

- **Issue tracker:** `charlesroper/C64_music` via `gh` CLI (`docs/agents/issue-tracker.md`). Close issues only with `npm run issue:close -- <number> --comment "..."` (never `gh issue close`).
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (`docs/agents/triage-labels.md`).
- **Domain docs:** Single `GLOSSARY.md` and `docs/adr/` at repo root (`docs/agents/domain.md`).
- **Browser verification:** Read `docs/agents/browser-verification.md` before writing or debugging headless browser checks (skip when only running `npm run check:layout` or `npm run check:help-popovers`).
- **Skill overrides (`implement`, `tdd`, `code-review`):** Load `.agents/skills/<name>/SKILL.md` via `read_file` when no `Skill` tool exists; open `implement` responses with `Issue #<n>: <title>`, check `git log -n 15 --grep="#<n>"` before implementing, skip typechecking (plain JS), and tick criteria + `npm run issue:close -- <n>` when done; `tdd` treats `ready-for-agent` Testing Decisions and acceptance criteria as pre-agreed seams; `code-review` defaults unspecified fixed points to `HEAD~1` or uncommitted `HEAD`.
