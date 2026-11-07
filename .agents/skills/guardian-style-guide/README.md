# Guardian style guide skill

An agent skill and reference library for copy-editing and writing text to the Guardian and Observer style guide while preserving your original voice, structure and argument.

## Why use this skill

Published online in the early 2000s, the [Guardian and Observer style guide](https://www.theguardian.com/info/series/the-guardian-style-guide) is one of the most widely referenced journalism stylebooks in the English-speaking world. Long championed by the paper's style editor, David Marsh, as "neither pedantic nor wild", its philosophy treats language as a living tool – prioritising plain English clarity and ethical precision without crushing an author's voice.

Standard language models default to American English conventions, bureaucratic jargon or breathless broadsheet cliches. This skill directs agents to:
- **Enforce British English spelling:** Use `-ise`, `-our`, `-re` and doubled `l` forms (`organise`, `colour`, `centre`, `travelled`).
- **Apply down-style capitalisation:** Lowercase `government`, `cabinet`, political parties (`Labour party`) and job descriptions (`prime minister`), rejecting false titles and institutional inflation.
- **Format punctuation to house style:** Use spaced en-dashes (`–`) for parenthetical pauses, favour one-word compounds (`thinktank`, `standup`), strip serial commas in straightforward lists and format quotes with British nesting.
- **Default to neutral attribution:** Replace editorialising tags (`insisted`, `warned`, `admitted`) with neutral `said`.
- **Use progressive house terminology:** Prefer accurate environmental terms (`climate crisis`, `global heating`), gender-neutral occupational nouns (`actor`, `chair`) and respectful people-first language.
- **Search unabridged references offline:** Check obscure proper nouns, diplomatic titles and foreign placenames across all 26 letters without overflowing token limits.

## Skill structure

- `SKILL.md`: The skill definition, copy-editing workflow and core house mechanics.
- `references/`: The unabridged style guide split into four volumes (`a-f`, `g-l`, `m-r`, `s-z`).
- `guardian_style_guide.py`: Zero-dependency Python script to re-fetch and rebuild reference volumes from `theguardian.com`.
- `pyproject.toml`: Optional Python package metadata and CLI entry point (`guardian-style-guide`).

## Install the skill

This skill follows the open [Agent Skills](https://agentskills.io/) specification.

### Project installation
Copy the `guardian-style-guide` directory into your project's agent skills directory (typically `.agents/skills/`):

```bash
# Copy from a clone of this repository
cp -r guardian-style-guide /path/to/project/.agents/skills/

# Or fetch only this skill using Git sparse checkout
git clone --depth 1 --filter=blob:none --sparse https://github.com/charlesroper/skills.git /tmp/skills
git -C /tmp/skills sparse-checkout set guardian-style-guide
cp -r /tmp/skills/guardian-style-guide /path/to/project/.agents/skills/
rm -rf /tmp/skills
```

### Global installation
Copy this directory into your agent's global skills directory to make it available across all workspaces on your device.

## Sub-edit text with an agent

Prompt your agent to edit a draft:

> "Sub-edit this draft into Guardian style and provide a changelog of corrections."

The agent applies core house mechanics, consults `references/` for edge cases and returns the revised copy followed by a bulleted changelog.

## Update reference data from the Guardian

A scheduled GitHub Actions workflow checks for upstream changes every Sunday evening and opens a pull request when differences are detected.

To refresh local reference files manually, run `guardian_style_guide.py` with `python3` (the script uses only Python's standard library and requires no external packages):

```bash
python3 guardian_style_guide.py
```

The script rewrites files only when substantive entries have changed. To force a rewrite regardless of changes, pass `--force`:

```bash
python3 guardian_style_guide.py --force
```

To test a single letter:

```bash
python3 guardian_style_guide.py --letters z
```

To run the offline parser verification suite:

```bash
python3 guardian_style_guide.py --selftest
```

## Licence

The skill definition and Python tooling are licensed under the MIT licence. The style guide contents remain the intellectual property of Guardian News & Media Limited.
