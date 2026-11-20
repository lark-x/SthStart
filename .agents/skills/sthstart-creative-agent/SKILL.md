---
name: sthstart-creative-agent
description: Operate SthStart's scoped external creative Agent through its MCP bridge. Use when reading creative runs, proposing a workflow, starting or stopping an authorized run, or resuming an external Agent workflow; exclude Web UI approval, publication, grant management, and direct canonical-content edits.
---

# SthStart Creative Agent

Use the `sthstart-creative-agent` stdio MCP. Its token is a scoped grant, not an administrator credential. Never ask for a raw token in chat, never copy it into files or the final response, and never replace the configured token with an administrator secret.

Read current state before acting:

1. Use `list_runs` to find the run instead of guessing an ID.
2. Use `get_run` before a retry or stop. Distinguish `queued`, `running`, `waiting_approval`, `paused`, `uncertain`, `completed`, `failed`, and `cancelled`.
3. Before a direct candidate, use `read_context` for the exact grant scope and retain its top-level `contextHash`; do not hash the returned context yourself.
4. Use `creative.memory.facts` to page through the branch fact index when context is truncated. Pass `actorId` for that actor's known facts; omit it only for the director's omniscient view. Use `creative.memory.entries` open when checking adopted settings and foreshadowing.
5. Reuse the original `idempotencyKey` when retrying `start_run` or `submit_candidate`; a changed payload with the same key is a conflict.
6. Use `stop_run` for unfinished work. Stopping prevents later dispatch where supported but does not refund calls that may already be in progress.

`propose_creative_run` returns a conversation suggestion only. It does not create or adopt a scene, execute a workflow, approve content, or alter formal Story, StoryWorld, Generation, or Publication data. Treat its proposal as an unapproved option.

The scoped MCP exposes advisory proposals only. Do not add `mode: "ai"`, `budget`, or `idempotencyKey` to `propose_creative_run`, and do not target the administrator's AI conversation workflow through `start_run`; both paths are intentionally forbidden to external grants.

`submit_candidate` accepts only a direct `scene`, `visual-brief`, or `video-plan` candidate with a SHA-256 `contextHash` and stable `idempotencyKey`. Read the current scoped context first. A safe receipt says `candidate` and `review: { required: true, status: pending }`; it never means approved, accepted, adopted, or published. Reuse the original key on retries and stop if the server reports a context or idempotency conflict.

Candidate submission does not start the review run or spend budget. Do not claim that a pending review is already executing. Site staff start review separately; that later run still requires the grant's `run` permission and cumulative budget.

Respect the grant's operational limits:

- `read`, `propose`, `run`, and `stop` are separate permissions.
- A run must stay inside the grant scope; report a scope violation instead of retrying with broader identifiers.
- The two memory tools require `read` permission and use offset/limit pagination. Never widen a truncated result with a different scope or invent entries that the tool did not return.
- Calls consume the run budget and run envelopes consume the grant's cumulative budget. Do not split a logical retry into new idempotency keys to avoid a conflict.
- A 401 means the grant is unknown, revoked, or expired. A 403 means the action or scope is not granted. A 409 budget, revision, or idempotency conflict must be resolved from current state.

The scoped Agent cannot approve, formally adopt, publish, manage grants, raise budgets, read global provider secrets, or force a candidate through canonical adoption. `submit_candidate` may place a candidate into the shared review path, but `propose_creative_run` cannot be used as a substitute and no receipt grants formal adoption.
