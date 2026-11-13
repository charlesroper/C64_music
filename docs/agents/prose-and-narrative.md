# Prose, UI copy and narrative rules

Read this file before editing `README.md`, `NARRATIVE.md`, UI copy or track catalogue descriptions. House rules override the general writing skills.

## Stage 1: drafting

| Surface | Skill |
|---|---|
| `README.md` introduction, architecture, capabilities and developer workflow | `on-writing-well`. Keep the voice human and enticing. |
| `README.md` install, build and command instructions | `on-writing-well` for voice, then `ste-80` for the steps: one action per step, one meaning per term, explicit outcome. Do not flatten the surrounding prose. |
| UI copy and catalogue descriptions | `on-writing-well` and `guardian-style-guide`. |
| `NARRATIVE.md` | `project-narrative`, then the eight-section rules below. |
| `AGENTS.md` and skill files | `writing-for-agents`. |
| Commit messages | `cbeams-git-commit-messages`. |

Skills resolve by name. Repo copies live under `.agents/skills/`. `project-narrative`, `cbeams-git-commit-messages` and `ste-80` are installed globally.

## Stage 2: sub-editor gate

Pass drafted prose, UI copy and documentation through `guardian-style-guide` before delivery. Enforce British English, sentence case and the AI trope check. Commit messages are exempt, as are Martin Galway's verbatim quotations.

## House rules

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

## Project narrative

`NARRATIVE.md` powers the in-app THE STORY modal. Keep its eight-section progressive layout:

- Sections 1 to 3 orient non-technical listeners with no assumed 6502 knowledge.
- Sections 4 to 8 move into hardware, assembly and build detail.
- Do not replace the layout with the nine-section template in `project-narrative`.
- Keep Martin Galway's quotations verbatim.
- Respect `src/markdown.js`: full `https://` URLs only, `#`, `##` and `###` headings only, single-line unwrapped paragraphs and code spans around `*` expressions.

Completion: the edited prose passes the repository rules test, with zero em-dashes and no broken Markdown rendering.
