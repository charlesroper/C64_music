# Galway 2664 Coding Standards

This document defines the engineering standards and quality gates for the Galway 2664 Commodore 64 music workbench. Code review agents and human contributors must evaluate all pull requests and commits against these rules.

---

## 1. Historical Source Code Integrity (Frozen Baseline)

Martin Galway's original Commodore 64 assembly source files and directives are historic artifacts. They must remain authentic and unmodified:

* `wizball.asm`
* `arkanoid.asm`
* `arkadrum.asm`
* `gameover.asm`
* `greenberet.asm`
* `rambload.asm`
* `ocean_assembler_directives.txt`

**Rule 1.1**: Never edit, patch, reformat, or re-encode these seven files.
**Rule 1.2**: All assembler bug fixes, label resolutions, syntax accommodations, and catalog adjustments belong in the assembler (`src/ocean_assembler.js`), player engine (`src/player_engine.js`), web presentation driver (`src/workbench_view.js`), or track catalog metadata (`src/tracks_catalog.js`).
**Rule 1.3**: Authenticity is guarded by SHA-256 cryptographic verification in the test suite.

---

## 2. Typography and Prose Rules

**Rule 2.1 (Zero Em-Dashes)**: Never use literal em-dash characters (Unicode U+2014) anywhere in this repository. This applies without exception across markdown documentation, source code, comments, commit messages, and HTML. Use commas, colons, parentheses, or periods instead.
**Rule 2.2 (William Zinsser Prose)**: Keep all documentation concise, active, and direct. Avoid marketing hype, jargon, buzzwords, and redundant filler.

---

## 3. Architecture and Deep Modules

The system follows John Ousterhout's philosophy of deep modules: small, simple interfaces that hide substantial internal complexity behind clean seams.

**Rule 3.1 (Architectural Seams)**:
* Presentation (`src/workbench_view.js`) must not import or invoke WebAssembly, Web Audio, or raw emulator internals directly. It mounts behind `createWorkbenchView(container, options)` and accepts a player adapter interface.
* Automated UI tests must drive the presentation layer using `createFakePlayer` rather than instantiating the real emulator, keeping test runtimes under 100 milliseconds.
**Rule 3.2 (Domain Vocabulary)**:
* Contributors must adhere to domain concepts defined in `GLOSSARY.md` (e.g. *Player Engine*, *Telemetry Snapshot*, *Workbench View*, *Track Session*, *Loader Adapter*, *Source Index*, *Idle Render Path*, *Seam*).
* Avoid inventing ad-hoc terms or synonyms.
**Rule 3.3 (Architectural Decisions)**:
* Significant architectural seams and trade-offs must be recorded as Architectural Decision Records under `docs/adr/` using the template specified in `.agents/skills/domain-modeling/ADR-FORMAT.md`.

---

## 4. State, Performance, and Rendering

**Rule 4.1 (Idle Render Throttling)**:
* When playback is paused or the document is backgrounded (`document.hidden`), the animation loop must skip C64 monitor pixel transfers (`putImageData`), oscilloscope path strokes, and telemetry DOM writes.
* Display refresh rates must clamp to 60 Hz to avoid wasting cycles on high-refresh panels (120 Hz / 144 Hz) for 50 Hz PAL emulation.
**Rule 4.2 (Telemetry Change Guards)**:
* Presentation updates must check previous values before modifying DOM elements, hexadecimal register cells, voice classes, or dataset attributes. Redundant identical writes must be zero.
* Morse code subtitle strings must only re-render when the decoded character index advances.
**Rule 4.3 (Lazy Assembly and Cache Reuse)**:
* Historical assembly files must assemble lazily on demand when a game is selected, not eagerly on boot.
* Formatted source viewer HTML must be cached per file to eliminate redundant tokenization when switching back and forth between games.
**Rule 4.4 (Zero Allocation Telemetry)**:
* Engine telemetry snapshots (`player.getTelemetry()`) must populate a pre-allocated object and reuse typed array buffers to prevent garbage collection pauses during live audio synthesis.

---

## 5. Calendar Versioning (CalVer)

Deployments are identified by Calendar Versioning (`YYYY.MM.DD` or `YYYY.MM.DD.MICRO`).

**Rule 5.1 (Four-File Synchronization)**: Every version change must update all four files in lockstep:
1. `package.json`: `"version": "YYYY.MM.DD"`
2. `package-lock.json`: root package `"version": "YYYY.MM.DD"`
3. `index.html`: document title and header badge (`<span class="brand-version" id="app-version">vYYYY.MM.DD</span>`)
4. `src/version.js`: `export const APP_VERSION = "YYYY.MM.DD";`
**Rule 5.2 (Same-Day Micro Increments)**: Multiple releases on the same date append `.1`, `.2`, `.3`. A new calendar day resets to `YYYY.MM.DD`.
**Rule 5.3 (Monotonicity Guard)**: Version bump scripts must refuse to lower a version if local machine time skew reports a date earlier than the current version in `package.json`.

---

## 6. Deployment and Preflight Guardrails

**Rule 6.1 (Clean Tree Preflight)**: Automated deployment (`scripts/deploy.mjs`) must refuse to deploy if the git working tree has uncommitted or untracked changes.
**Rule 6.2 (Remote Verification)**: Deployment must verify that the target git remote (`fork`) exists before attempting a push.
**Rule 6.3 (Quality Gate Preflight)**: Deployment must execute `npm run lint` and `npm test` before pushing to `fork/main`. If any check fails, the deployment must abort immediately and distinguish push failure from success.

---

## 7. Documentation and Dev Blog Synchronization

**Rule 7.1 (Dual-Document Lockstep)**:
* Feature additions, defect fixes, workflow scripts, or test suite alterations must update `README.md` and `NARRATIVE.md` simultaneously.
* The test counts and check lists in both documents must match the output of `npm test` exactly.
**Rule 7.2 (Mandatory Dev Blog Entries)**:
* Every story-changing milestone (new feature, significant bug fix, architectural seam, performance optimization, or notable failure/reversal) must append a dated entry (`### DD Month YYYY: title`) to Section 8 of `NARRATIVE.md`.
* Trivial maintenance and chore commits (typo fixes, CalVer version bumps, routine formatting) must be excluded from the dev blog.

---

## 8. Commit Message Standards

Commit messages must adhere to Chris Beams' guidelines:

1. Separate subject from body with a blank line.
2. Limit the subject line to 50 characters.
3. Capitalize the subject line.
4. Do not end the subject line with a period.
5. Use the imperative mood in the subject line (e.g. "Add...", "Fix...", "Refactor...").
6. Wrap the body at 72 characters.
7. Use the body to explain *what* and *why* vs. *how*.
8. Ensure zero em-dashes appear in the subject or body.

---

## 9. Test-Driven Development (TDD)

**Rule 9.1 (Test-First Bug Fixes)**: Every bug fix must begin with a reproduction test that fails at the baseline commit before any fix code is written.
**Rule 9.2 (Seam-Driven Assertions)**: Tests must assert on external caller-observable behavior through module seams. Tests must not inspect internal private state or duplicate the implementation in assertions.
**Rule 9.3 (Strict Element Identification)**: Browser harness mocks must throw on missing element IDs to prevent silent drift between test doubles and production markup.
**Rule 9.4 (Issue Definition of Done Synchronization)**: When working on issues with a Definition of Done (DoD) or task checklist, update the issue body to check off items as tasks are implemented and verified. Do not leave completed DoD items unchecked.
