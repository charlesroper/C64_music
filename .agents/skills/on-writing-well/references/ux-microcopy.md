# UX and microcopy

Apply this playbook when the active Surface is **UX & Microcopy**: UI labels, buttons, form fields, validation and error messages, CLI prompts and terminal output, empty states, confirmation dialogs, tooltips and onboarding flows.

## 1. Treat words as interface design (Metts & Welfle)

Microcopy forms the control surface of an interface.

- **Fix the flow before padding the text:** When a button, flag or setting requires three sentences of helper text to prevent mistakes, simplify the label or split the choice instead of writing a longer warning.
- **Match the user's mental model:** Translate database states, HTTP codes and internal exceptions into what they mean for the person using the tool (*"Your session expired"* rather than *"Token validation error 401"*).

## 2. Evaluate every string against four criteria (Podmajersky)

Check every piece of UX or CLI copy in this order:

1. **Purposeful:** Does the text help the user complete their **Reader Job** while supporting the system's goal? Cut any string that states the obvious (such as helper text beneath an `Email address` field that says *"Enter your email address"*).
2. **Concise:** Can the user read and act on it in under a second? Front-load the operative words, drop unnecessary articles (`a`, `the`) in tight UI/CLI strings, and omit full stops on single-phrase labels, buttons, headings and tooltips.
3. **Conversational:** Would a helpful colleague say this aloud? Use natural phrasing and contractions where appropriate to the brand, replacing robotic passive voice (*"File could not be saved"* -> *"Could not save file"*).
4. **Clear:** Is every action and outcome unambiguous? Use specific `Verb + Object` labels on controls so the user knows the exact consequence of acting before they click or press Enter.

## 3. Component patterns (Yifrah)

### Error messages (UI and CLI)

An error message must never blame the user or leave them stranded. Structure every error around three parts:

1. **What happened:** State the problem plainly without jargon or stack-trace codes in the primary message.
2. **Why it happened:** Name the cause when it helps the user understand the constraint.
3. **How to fix it right now:** Give the exact action, link or runnable command to recover.

- **Weak:** `Error: EACCES permission denied on /etc/app/config.json`
- **Strong:** `Cannot write to /etc/app/config.json (permission denied). Run the command again with sudo, or pass --config ~/.config/app/config.json.`

### Buttons, dialogs and confirmations

- **Echo the heading verb in the button:** If a confirmation dialog asks *"Delete the staging database?"*, the buttons must be **Delete database** and **Keep database** (or **Cancel**). Never pair a destructive question with **Yes** / **No** or **OK** / **Cancel**.
- **State toggle states in the positive:** Write checkbox and toggle labels as affirmative statements so *on* always means *active* (`Send weekly digest emails`, never `Do not disable email notifications`).

### Empty states

An empty state is an onboarding moment. Replace bare *"No items found"* messages with three elements:

- **What belongs here + why it matters + primary action:**
  - *Heading:* `No API keys yet`
  - *Body:* `Create an API key to authenticate requests from your CLI or CI pipeline.`
  - *Action:* **Create API key**

### Forms, inputs and helper text

- **Keep labels permanent:** Place field labels above the input. Use placeholder text only for formatting examples (`e.g. name@example.com`), never as the only label, because placeholders vanish as soon as the user types.
- **Answer hesitation upfront:** When asking for sensitive data (phone number, billing card, repository write permissions), add one short line explaining why it is needed right beside the field.

## Pre-delivery checklist

1. Is every button and action labelled with a specific `Verb + Object` that matches its dialog heading?
2. Does every error message state what went wrong, why and the exact step or command to recover?
3. Do empty states explain what belongs in the space and provide the action to start?
4. Are single-line labels, buttons and headings free of trailing full stops and redundant helper text?
5. Are internal error codes, schema names and passive phrasing replaced with human terms?
