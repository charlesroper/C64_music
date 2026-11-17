---
name: cbeams-git-commit-messages
description: Write clear, consistent Git commit messages following Chris Beams' seven rules. Use when the user asks for a commit message, asks to improve one, or shares a diff and wants commit wording.
metadata:
  version: "1.2.0"
---

# cbeams-git-commit-messages

## Purpose

Help the user write, revise or review Git commit messages that are easy to scan, consistent across a repo and informative in history.

In the **Editorial Pipeline**, `cbeams-git-commit-messages` serves as Stage 1 drafting for commit messages. Commit messages are exempt from the Stage 2 Sub-Editor Gate.

## When to use

Use this skill whenever:
- Asking for a commit message for staged changes or a diff.
- Pasting a diff or summary and asking what to commit.
- Asking to improve, revise or shorten an existing commit message.
- Reviewing whether a commit message follows Chris Beams' seven rules.

## Procedure

1. **Analyse the change**: Read the diff, patch or summary of changes. If context is missing, ask the user in a single turn for a short summary of what changed and why, or the diff itself. *Completion: The single controlling change and the reason for it can be stated in one sentence.*
2. **Draft the subject line**: Write a single line in the imperative mood (eg `Add`, `Fix`, `Refactor`, `Remove`, `Update`). Capitalise the first word, omit trailing full stops, and aim for 50 characters or fewer (72 characters maximum). Prefer rewriting over truncation. *Completion: Imperative subject line under 50 characters (max 72) with no trailing punctuation.*
3. **Draft the body**: Include a body only if the change needs explanation beyond the subject line. Separate subject and body with a single blank line. Wrap lines at 72 characters. Explain what changed and why it changed (the diff shows how). Use short paragraphs separated by a single blank line, or concise bullet points. *Completion: Body explains what and why wrapped at 72 characters, or is omitted when the subject line suffices.*
4. **Add issue footer**: If an issue or ticket reference is provided, append it after a blank line using tracker conventions (eg `Fixes #123`, `Refs #123` or repository tracker format). Never invent issue references. *Completion: Provided issue references are appended as footers separated by a single blank line.*
5. **Verify against the quality checklist and deliver directly**: Verify against the **Commit quality checklist** below. Deliver raw text directly without markdown fences, code blocks, quote marks or conversational preamble. *Completion: All quality checks pass and output is delivered directly as plain text.*

## Commit quality checklist

Before delivering, verify the message against Chris Beams' seven rules and repository standards:

1. **Separate subject from body with a blank line:** Always place a single blank line between subject and body, and between body and footers.
2. **Limit subject line to 50 characters:** Target 50 characters or fewer; never exceed 72 characters. Prefer rewriting over truncation.
3. **Capitalise the subject line:** Begin the subject with an uppercase letter.
4. **Do not end the subject line with a full stop:** Omit trailing punctuation from the subject line.
5. **Use the imperative mood in the subject line:** Use imperative verbs (`Add`, `Fix`, `Refactor`, `Remove`, `Update`), avoiding past tense (`Added`, `Fixed`) or vague wording (`Update stuff`).
6. **Wrap the body at 72 characters:** Wrap all body paragraphs and bullet lines at 72 columns.
7. **Use the body to explain what and why vs how:** Focus on motivation, context and impact; leave the implementation mechanics to the diff.
8. **Plain text delivery:** Output raw ASCII text only – no Markdown code blocks, quotation marks or trailing whitespace.

## Examples

Good subject only:
Refactor cache key generation

Good subject and body (prose):
Fix race condition in webhook retries

Prevent concurrent retry workers from processing the same webhook event.

This avoids duplicate outbound calls and inconsistent delivery state
during peak traffic.

Good subject and body (bullets):
Improve commit-message skill and examples

- Move version into metadata.version to match the Agent Skills specification
- Add examples and a body template: Context -> Change -> Reason/impact
- Expand subject anti-patterns and quality checks; prefer rewriting over
  truncation to preserve meaning
- Remove frontmatter tags to comply with the spec

Bad to better rewrite:
Bad: Updated things
Better: Update deployment health check defaults
