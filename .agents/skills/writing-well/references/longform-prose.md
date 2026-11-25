# Longform prose

Apply this playbook when the active Surface is **Longform Prose**: essays, blog posts, architecture narratives, post-mortems and continuous explanatory writing read linearly from top to bottom.

## 1. Choose the narrator's stance

Before drafting, pick the capacity in which you address the reader under the **Universal Core** unity rule:

- **First person singular (`I`):** Personal experience, direct observation or individual argument.
- **First person plural (`we`):** Shared engineering work, team post-mortems or collective decisions.
- **Second person (`you`):** Direct coaching or walkthroughs.
- **Third person:** Objective reporting and historical analysis.

## 2. Hook the lead and build linear momentum

- **Hook the reader in sentence one:** Open with a concrete tension, a surprising fact, a paradox or a specific scene that compels the reader to read sentence two. Cut all throat-clearing background.
- **Build paragraph springboards:** Each paragraph must amplify the one before it and pull the reader into the next. Make the final sentence of each paragraph a springboard that carries the reader across the whitespace.
- **Sequence Concept Grounding:** Introduce new concepts one beat at a time inside the narrative arc so the reader never hits an ungrounded term mid-argument.

## 3. Control cadence and evidence

- **Trim redundant adverbs and judgment adjectives:** Delete adverbs that repeat what the verb already says (*"shouted loudly"* -> *"shouted"*) and adjectives that assert a judgment the evidence should prove.
- **Vary sentence length for cadence:** Read the draft by ear. Break up strings of uniform twenty-word sentences by following a longer, well-balanced sentence with a short declarative punch.
- **Trust your material:** Give the reader specific names, numbers, quotes, artefacts and failure modes instead of editorialising claims. Let the evidence create the emphasis.
- **Prefer continuous prose over lists:** Prose carries argument and cause-and-effect; bulleted lists carry parallel items. Use a list in longform prose only when three or more items are genuinely parallel and faster to scan than a sentence.

## 4. Stop when the facts end

- **End cleanly and abruptly:** Once the final point lands, stop.
- **Close on a resonant detail:** Delete concluding recaps. Close on a concrete detail, a lingering question, a quote or a crisp final observation.

### Before and after: lead, cadence and ending

**Before:**
> In this post, we will discuss why our team decided to migrate away from our legacy queueing system. Distributed queues are an essential component of modern cloud architectures, and reliability is very important. After experiencing several significant outages over the course of the summer, it became abundantly clear that a new approach was required. In conclusion, moving to SQLite for local job persistence solved our operational headaches and improved developer velocity.

**After:**
> At 3am on 14 August, our message broker lost four thousand webhook jobs without writing a single line to the error log. That outage forced us to ask why a service handling thirty requests a second needed a distributed cluster at all. We replaced the broker with a single SQLite file on local NVMe storage, and we have not been paged since.

## Pre-delivery checklist

1. Are pronoun, tense and mood consistent from start to finish?
2. Does every paragraph lean only on concepts that are already grounded?
3. Does the opening sentence hook the reader without background throat-clearing?
4. Do sentence lengths vary naturally when read aloud?
5. Does the final paragraph end cleanly on a point or detail without recapping the piece?
