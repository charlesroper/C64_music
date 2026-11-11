# Technical docs and READMEs

Apply this playbook when the active Surface is **Technical Docs & READMEs**: README files, developer guides, tutorials, API overviews, runbooks, architecture decision records (ADRs) and release notes.

## 1. Separate documentation intent

Before drafting, identify which job the document serves and keep its shape pure:

- **README or overview:** Orient the reader in under a minute. State what the project is, who it is for, why it exists and how to run the first working example.
- **How-to guide or tutorial:** Walk the reader through a sequence of steps to achieve a concrete outcome. Keep exhaustive flag tables out of the walkthrough; link to reference docs instead.
- **Reference:** Provide fast, scannable lookup for commands, parameters, APIs, types and error codes. Keep narrative explanations out of parameter tables.
- **Architecture or decision record (ADR):** State the context, the decision made, the trade-offs accepted and the consequences in tight prose.

## 2. Structure for task execution

- **Organise from why, to what, to how:**
  1. **Why:** When to use the tool or feature and what problem it solves.
  2. **What:** Core concepts and components (**Concept Grounding** before procedures).
  3. **How:** Step-by-step procedures and runnable examples.
- **Let headings do the signposting:** Use specific, task-oriented headings (`## Configure automatic network failover`, not `## Configuration`). Start immediately with the substance under every heading instead of announcing what the section will cover.
- **Group related ideas:** Explain each concept in one place. Keep list items grammatically parallel.
- **Keep warnings adjacent:** Place prerequisites before the steps that require them, and put warnings or gotchas directly above the step they affect.

## 3. Examples, scannability and typography

- **Prioritise visual scannability:** Technical readers scan for commands, keys and failure modes. Use bold lead-in keys (`* **Key:** Description`) for reference catalogues, numbered lists starting with action verbs for sequential procedures, and tables when three or more items share the same attributes.
- **Show, then explain:** Pair key concepts with a minimal, realistic, runnable code snippet that highlights only the relevant lines.
- **Apply consistent typography:**
  - Inline code, file paths and commands: `` `npm install` ``
  - Options and flags: `--watch`
  - UI elements: **bold**, with navigation written in order (**Settings**, then **Update**)
  - Code blocks: always include a language tag (`bash`, `python`, `json`)

  ```bash
  # Install dependencies
  npm install
  ```

### Before and after: procedural documentation

**Before:**
> The `connection_timeout` variable essentially serves to dictate the exact duration of elapsed seconds that the client driver will continue to wait whilst attempting to establish an active socket connection prior to raising an exception. Before attempting to run the migration script against production, engineers should ensure that a snapshot backup has been taken.

**After:**
> `connection_timeout` sets how many seconds the client waits for a socket connection before raising an error.
>
> **Warning:** Take a snapshot backup before running the migration against production. Schema conflicts can cause permanent data loss.
>
> 1. Create a production snapshot:
>    ```bash
>    pg_dump "$PROD_DB_URL" > backup.sql
>    ```
> 2. Run the migration script:
>    ```bash
>    python3 -m migrate --target production
>    ```

## Pre-delivery checklist

1. Does sentence one state what the subject is, who it is for and what it does?
2. Are prerequisites and warnings placed immediately before the step they affect?
3. Does every procedural step start with an imperative action verb?
4. Are code blocks tagged with a language and runnable without guesswork?
5. Are commands, flags, APIs and UI labels named identically throughout the document?
