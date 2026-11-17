---
status: accepted
---

# CSS Module Architecture and Delivery

Split the single 3,030-line stylesheet into modular, zero-build CSS files under `src/styles/` using `@layer` cascade ordering, MaintainableCSS `lowerCamelCase` naming, and parallel `<link>` delivery in `index.html`.

## Context

`src/styles.css` grew to 3,030 lines, with 620 lines of `@media` overrides isolated at the bottom of the file, 15 `#id` style selectors, hardcoded spacing/radii/z-index values, and global utility/state classes (`.hidden`, `.is-open`, `.active`, `.c64-caps`). The repository serves static ES modules directly on GitHub Pages with no bundler and enforces formatting and linting through Biome (`npm run check:lint`) plus deterministic tests in `tests/`.

## Decision

- **Parallel `<link>` modules, no bundler:** Split styles into 14 single-responsibility files under `src/styles/` (targeting under 450 lines each so Biome one-declaration-per-line formatting keeps each module intact):
  - Foundation: `foundation.css` (reset, tokens, base, `.hidden` state)
  - Shared primitives and shell: `buttons.css` (buttons, `.btn-mini-action`, `.btn-accent`, `.icon`, `.icon-button`), `workbench-shell.css` (shell, grid, `.panel`, `.panel-header`, `.toggle-label`, mobile tabs), `top-bar.css`, `hardware-controls.css`, `help-popover.css`, `modal.css`, `boot-sequence.css`
  - Workbench panels and overlays: `source-panel.css` (`Source Files Panel`, `Tunes Panel`, `Game Metadata Card`), `c64-monitor.css` (`C64 Monitor`, `HUD Row Guide`, Morse banner, `C64 Key Injector`), `oscilloscopes-panel.css` (`Oscilloscopes Panel`, `Filter and Digi-Drum Card`), `source-viewer.css` (`Source Viewer`), `sid-register-strip.css` (`SID Register Strip`), `stats-for-nerds.css` (`Stats for Nerds`)
  Load all stylesheets via parallel `<link rel="stylesheet">` tags in `index.html` rather than CSS `@import`.
- **CalVer sync across all CSS links:** Update `scripts/bump_version.mjs`, `CODING_STANDARDS.md` Rule 5.1, and `tests/repo_rules.test.mjs` so `npm run bump` stamps `?v=YYYY.MM.DD` onto every `./src/styles/*.css` `<link>` tag in `index.html` in lockstep.
- **Native `@layer` ordering:** Declare `@layer reset, tokens, base, modules, state;` in `foundation.css`. Keep `.hidden { display: none; }` in `@layer state` (its display-suppression behaviour is identical everywhere) and keep reduced-motion suppression after its module rule so zero `!important` declarations remain.
- **MaintainableCSS naming and co-located media queries:** Adopt `lowerCamelCase` delimiter grammar (`.module[-component][-state|--modifier]`), single-class specificity with zero `#id` style selectors, ARIA attributes paired with `.module-isState` / `.module-component-isState` classes, `.srOnly` and `.c64Caps` in `lowerCamelCase`, and `@media` queries co-located inside each owning module file.
- **Expanded tokens with pixel-locked exemptions:** Extend `:root` tokens to colours, typography, spacing, radii, and explicit `--z-*` tiers, while preserving exact pixel geometry where `scripts/check_layout.mjs` enforces footer and oscilloscope stability.
- **STE-80 comments for module headers and defensive rules:** Document each module file header and non-obvious defensive rule (`min-width: 0`, `overflow-wrap`, `@layer` order, pixel-locked geometry) in Simplified Technical English (`ste-80`: active present tense, <= 25 words per descriptive sentence, `GLOSSARY.md` terms, noun clusters <= 3 words, no `-ing` participles, and `CAUTION:` notices before layout-sensitive rules).
- **Biome plus repo tests instead of Stylelint:** Keep Biome as the sole formatter/linter and enforce project CSS invariants (zero `#id` styling, zero unapproved `!important`, file line budgets, naming grammar) in `tests/repo_rules.test.mjs`.

## Considered Options

- **Introduce Vite, PostCSS, or a CSS concatenation build step:** Rejected. Contradicts the zero-build static ES module architecture and complicates local verification and deployment.
- **Load modules via CSS `@import` from `src/styles.css`:** Rejected. `@import` triggers sequential round-trip fetch waterfalls, whereas parallel `<link>` tags preload over HTTP/2 on GitHub Pages.
- **Adopt BEM, DRY utility classes, or `[aria-*]`-only styling:** Rejected. Conflicts with the repository's installed `maintainable-css` skill and spreads utility overrides across markup.
- **Add Stylelint alongside Biome:** Rejected. Duplicates CSS lint configuration when Biome plus deterministic `tests/repo_rules.test.mjs` checks cover the required invariants.
- **Keep legacy kebab-case class names permanently:** Rejected. Leaves mixed naming conventions in place and lets future changes drift back to ad-hoc selectors and distant overrides.

## Consequences

- Agents and contributors can inspect and edit one UI module in a single under-450-line file with its `@media` rules co-located.
- Tests that previously read `src/styles.css` directly (`tests/mobile_ui_layout.test.mjs`, `tests/spa_boot_and_play.test.mjs`) must load all `<link rel="stylesheet">` files referenced by `index.html` in order.
- Future contributors must not "simplify" the multi-`<link>` setup back into `@import` or add a bundler, nor replace pixel-locked telemetry dimensions with coarse spacing tokens without passing `npm run check:layout`.
- The migration runs in two stages under one specification: structure, layers, tokens, and `#id` removal first (keeping existing tests green), followed by per-module `lowerCamelCase` renames across `index.html`, JS modules, tests, and browser checks. During intermediate CSS module edits, run `node --test tests/mobile_ui_layout.test.mjs tests/repo_rules.test.mjs` for fast feedback before the final full `npm test` and Chromium gates.
