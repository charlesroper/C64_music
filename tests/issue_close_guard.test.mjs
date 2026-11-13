import assert from "node:assert/strict";
import test from "node:test";
import { auditChecklist, isTransientGhError } from "../scripts/close_issue.mjs";

test("issue close guard blocks unchecked acceptance criteria", () => {
  const { total, unchecked } = auditChecklist(`
- [x] Engine Core owns the loader adapters.
- [ ] Telemetry stream uses transferred buffers.
* [X] Existing tests stay green.
`);

  assert.equal(total, 3);
  assert.deepEqual(unchecked, ["Telemetry stream uses transferred buffers."]);
});

test("issue close guard passes a fully checked checklist", () => {
  const { total, unchecked } = auditChecklist(`
- [x] First criterion.
- [X] Second criterion.
`);

  assert.equal(total, 2);
  assert.deepEqual(unchecked, []);
});

test("issue close guard reports an empty checklist", () => {
  const { total, unchecked } = auditChecklist("No task list here.");

  assert.equal(total, 0);
  assert.deepEqual(unchecked, []);
});

test("issue close guard retries transient GitHub API errors only", () => {
  assert.equal(
    isTransientGhError({ stderr: 'Post "https://api.github.com/graphql": unexpected EOF' }),
    true,
  );
  assert.equal(isTransientGhError({ stderr: "HTTP 503 Service Unavailable" }), true);
  assert.equal(isTransientGhError({ stderr: "HTTP 404 Not Found" }), false);
  assert.equal(isTransientGhError(new Error("spawn gh ENOENT")), false);
});
