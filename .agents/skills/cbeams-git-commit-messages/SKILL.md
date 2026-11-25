---
name: cbeams-git-commit-messages
description: Draft, revise or review Git commit messages using Chris Beams' rules. User instructions, repository policy and lint configuration win.
metadata:
  version: "1.4.0"
---

# cbeams-git-commit-messages

## Purpose

Help the user write, revise or review Git commit messages that are easy to scan, consistent across a repo and informative in history.

In the **Editorial Pipeline**, `cbeams-git-commit-messages` serves as Stage 1 drafting for commit messages. Commit messages are exempt from the Stage 2 Sub-Editor Gate.

## When to use

Use this skill whenever:
- Drafting a commit message for staged changes.
- Revising or shortening an existing commit message.
- Reviewing a commit message against these rules and the repository's policy.

## Precedence

Apply the first rule that exists:

1. An explicit user request, such as "strict Chris Beams" or "wrap the body at 72".
2. The repository's `AGENTS.md`, `Commit policy:` line, or commit policy file.
3. Its commit linter, which enforces its own configuration.
4. The defaults below.

## Defaults

| Mode | Header | Body |
| --- | --- | --- |
| Default | 72 characters maximum | no hard wrap |
| Strict | 50 characters maximum | wrap at 72 columns |

Strict mode applies only when the user or repository asks for it.

## Procedure

1. **Analyse the change**: Read the diff, patch or summary of changes. If context is missing, ask the user in a single turn for a short summary of what changed and why, or the diff itself. *Completion: The single controlling change and the reason for it can be stated in one sentence.*
2. **Draft the subject line**: Write one line in the imperative mood (eg `Add`, `Fix`, `Refactor`, `Remove`, `Update`) and omit trailing full stops. Follow the repository's commit style: when it adds a type or scope prefix, count it toward the header limit. *Completion: Header within the Defaults limit, no trailing punctuation, and the repository's case convention.*
3. **Draft the body**: Include a body only if the change needs explanation beyond the subject line. Explain what changed and why (the diff shows how), using short paragraphs or concise bullet points. Body wrapping follows Precedence and Defaults. *Completion: Body explains what and why with the required wrapping, or is omitted when the subject line suffices.*
4. **Add issue footer**: If an issue or ticket reference is provided, append it after a blank line using tracker conventions (eg `Fixes #123`, `Refs #123` or repository tracker format). For Git trailers, use `Token: value`, for example `Fixes: #123`; the form `Fixes #123` is valid for GitHub but is not a Git trailer. Never invent issue references. *Completion: Provided issue references are appended as footers separated by a single blank line, using trailer syntax where Git must read them.*
5. **Verify and deliver**: Check the message against the **Commit quality checklist**. If the repository has a commit linter, run it on the drafted message. Deliver raw text directly without markdown fences, code blocks, quote marks or conversational preamble. When another skill or the user will run `git commit`, stop after drafting and hand over the message; do not deliver the raw text as the final answer, and do not stage or commit. *Completion: Every checklist item passes and the linter passes or is absent; the message is delivered as plain text or handed to the executor.*

## Commit quality checklist

Before delivering, verify the message against these rules and repository standards:

1. **Separate subject from body with a blank line:** Always place a single blank line between subject and body, and between body and footers.
2. **Keep the subject line short:** Stay within the Defaults header limit. Prefer rewriting over truncation.
3. **Follow the repository's capitalisation:** Begin the subject with an uppercase letter, unless the repository's commit style requires a lowercase prefix.
4. **Do not end the subject line with a full stop:** Omit trailing punctuation from the subject line.
5. **Use the imperative mood in the subject line:** Use imperative verbs (`Add`, `Fix`, `Refactor`, `Remove`, `Update`), avoiding past tense (`Added`, `Fixed`) or vague wording (`Update stuff`).
6. **Follow the body-wrapping rule:** Use Precedence and Defaults.
7. **Use the body to explain what and why vs how:** Focus on motivation, context and impact; leave the implementation mechanics to the diff.
8. **Plain text delivery:** Output raw ASCII text only – no Markdown code blocks, quotation marks or trailing whitespace.

## Examples

Bodies wrap in these examples for readability; the default mode does not require it.

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
