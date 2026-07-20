# `lib/context-window.ts` — fitting the conversation under the 200K context window

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/context-window.ts`) — verified no copy or
> equivalent exists in `admin_athena`; see the Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1](../01-file-catalog.md) · Hotspot: [03 §1 row 13](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Before every LLM call, [`/api/chat`](./chat-route.md) passes the full reconstructed
conversation history through this module so the request fits inside the Anthropic API's
200K-token context window. It estimates tokens (chars ÷ 4), shrinks bloated tool results,
repairs broken tool-call/tool-result pairs, and — if still over budget — drops the oldest
message *groups* wholesale. Everything here is pure and per-request: the stored
conversation in the DB is never modified; only the outbound copy is reshaped.

## Depends on / consumed by

**Depends on:** nothing — zero imports. It defines its own structural `ModelMessage` type
(`{ role, content, providerOptions? }`) instead of importing the Vercel AI SDK's, so it
compiles independently but is *not* type-checked against the SDK's real message shapes
(relevant to a gotcha below). Hard-coded constants: `CONTEXT_WINDOW_TOKENS = 200_000`,
`MAX_OUTPUT_TOKENS = 65_536`, `SAFETY_BUFFER_TOKENS = 4_000`,
`TOOL_RESULT_CHAR_LIMIT = 12_000`, `TOOL_RESULT_HEAD_CHARS = 4_000`,
`TOOL_RESULT_TAIL_CHARS = 2_000`. Only side effect: `console.log` budget diagnostics.

**Consumed by** (verified by import grep at the pinned commit): exactly one caller —
`claudeai_athena/app/api/chat/route.ts` ([chat route](./chat-route.md)), which calls
`fitMessagesToContextWindow(messages, systemPrompt)` **with no options**, so all defaults
apply (`keepFirstUserMessage` is effectively always `false`). The other six exports are
exported but imported nowhere else — presumably for testability.

## Function-by-function

### `estimateTokens(text): number`

The token-estimation formula the whole file rests on: **`Math.ceil(text.length / 4)`** —
~4 characters per token, no tokenizer. (Hotspot row 13's second verify item.)

### `estimateMessageTokens(msg): number` (+ private `estimateToolResultTokens`)

Per-message estimate. String content → `estimateTokens`. Array content is summed per
part: `text`/`reasoning` → their text; `tool-call` → tool name + JSON-stringified
`input`; `tool-result` → typed handling of the AI SDK output union (`text`/`error-text`
→ `value`; `json`/`error-json` → `JSON.stringify(value)`; `content` → per-item);
**`image` and `file` parts → a flat 1,000 tokens each** regardless of actual size;
anything unrecognized → `JSON.stringify` of the whole part.

### `trimToolResults(messages): ModelMessage[]` — Phase 1

Returns a new array (copy-on-change; untouched messages keep referential identity) in
which any `tool-result` part whose output text exceeds **12,000 characters** is replaced
by its **first 4,000 chars + `[...truncated N characters...]` marker + last 2,000
chars**. Handles the output union: plain strings and `text`/`error-text` are truncated
in place; `json`/`error-json` are **serialized and converted to `text`/`error-text`**
(the output changes type, not just size); `content` arrays are truncated per text item.
Non-text items (e.g. media inside a `content` output) pass through untrimmed. Never
throws; unknown shapes are returned as-is.

### `ensureToolResultPairing(messages): ModelMessage[]` — Phase 1.5 and final repair

The pairing-repair pass — the hotspot's core item, so here is the exact algorithm:

1. Walk messages in order, pushing each into the result.
2. For each **assistant** message with array content, collect every `tool-call` part's
   `toolCallId` (plus `toolName` and `args ?? input`).
3. Look **only at the immediately next message**: if it is role `tool` *or* `user` with
   array content, collect the `toolCallId`s of its `tool-result` parts.
4. Any tool-call ID not found there is "unpaired": synthesize one `tool-result` part per
   unpaired call with placeholder content `'[Tool result from previous session]'`, and
   insert them as a **new `role: 'tool'` message immediately after the assistant
   message** (before the original next message).

Per the in-code comment, the motivating case is conversations reloaded from the DB where
`convertToModelMessages()` reconstructs tool-call blocks without matching results. It
also acts as the final safety net after truncation (see `fitMessagesToContextWindow`).

Two static caveats:

- **The synthesized part's shape doesn't match the rest of the file.** It carries its
  payload under `result: { type: 'text', value: ... }` — but everywhere else in this
  file (and in the AI SDK v5+ `ToolResultPart`; the app is on `ai@^6.0.97`) the payload
  field is **`output`**. The file's own `estimateToolResultTokens(part.output)` counts a
  synthesized part as 0 tokens, which suggests the placeholder may serialize as
  empty/invalid downstream. Whether the SDK accepts, drops, or rejects this shape is a
  runtime question (open question 2).
- **Repair only adds; it never removes.** An *orphaned tool-result* (a result whose
  tool-call was dropped) is not detected or deleted — see the pairing analysis under
  `truncateMessages`.

### `identifyMessageGroups(messages): MessageGroup[]`

Splits the conversation into groups of `{ startIndex, endIndex, tokens }`. A new group
starts at every **`user` or `system`** message; `assistant`/`tool` messages attach to the
current group (a leading assistant/tool message before any user message starts its own
group). So a group = one user turn plus the entire assistant/tool exchange that answers
it, which is what lets Phase 2 drop history without splitting an exchange.

### `truncateMessages(messages, tokenBudget, keepFirstUserMessage = false): ModelMessage[]` — Phase 2

1. Group the messages; if the summed estimate is already ≤ `tokenBudget`, return
   unchanged.
2. **Always keep the last group** (the current exchange), whatever its size.
3. If `keepFirstUserMessage` and there are > 2 groups, also reserve group 0.
4. Walk **backwards** from the second-to-last group, keeping each group whose tokens
   still fit; stop at the first one that doesn't (no cherry-picking — the kept tail is
   contiguous and chronological).
5. Emit: [group 0 if reserved] → if any groups were dropped, a synthetic **user** note
   (`[Note: N earlier message group(s) were omitted ...]`) followed by a synthetic
   **assistant** ack (`Understood, continuing from the available context.`) to preserve
   role alternation → the kept tail.

**How this preserves tool pairing (statically):** in the AI SDK model-message shape,
tool results are `role: 'tool'` messages, which never start a group — so a tool-call and
its result always land in the same group, and groups are only ever dropped whole from
the oldest end. On top of that, `fitMessagesToContextWindow` runs
`ensureToolResultPairing` again on the truncated output as a safety net for a kept group
that *ends* in an unanswered tool-call. The design is sound **for tool results carried
in `tool`-role messages**. The residual gap: `ensureToolResultPairing` itself
anticipates tool-results inside **`user`-role** messages (the Anthropic-native shape) —
and a user-role message always starts a *new* group, splitting it from the assistant
tool-call in the previous group. If the drop boundary fell between them, the kept tail
would begin with orphaned tool-results, which the repair pass cannot remove (it only
synthesizes missing results). Whether user-role tool-results can actually occur at this
point in the pipeline is open question 3.

**When even aggressive trimming can't fit:** there is no phase 3. If the always-kept
last group alone exceeds the budget (e.g. one enormous pasted user message, or a turn
with many near-12K tool results), the function returns note + last group **still over
budget**, and `fitMessagesToContextWindow` sends it anyway — the failure surfaces as an
Anthropic API 400, not here. Degenerate case: if the whole conversation is a *single*
group that's over budget, nothing is dropped at all and the input is returned unchanged
(`droppedGroups` is 0, so not even the note is added).

### `fitMessagesToContextWindow(messages, systemPrompt, options?): ModelMessage[]` — the main export

The orchestrator, and the only function the app actually calls:

1. Compute the budget:
   **`tokenBudget = contextWindow − maxOutput − safetyBuffer − estimateTokens(systemPrompt)`**
   = `200_000 − 65_536 − 4_000 − sys` ≈ **130,464 minus the system prompt** — i.e. the
   *message* budget is ~130K, well under the headline 200K (the catalog's "keep msgs
   < 200K" shorthand). The `maxOutput` default matches the route's `maxTokens: 65536`.
2. Phase 1: `trimToolResults`.
3. Phase 1.5: `ensureToolResultPairing`.
4. If the estimate now fits, return.
5. Phase 2: `truncateMessages(paired, tokenBudget, keepFirst)`.
6. Final safety: `ensureToolResultPairing` again, then return (with the over-budget
   caveat above — the final estimate is logged but not re-checked).

Each step logs a `[ContextWindow]` line with token counts. Never throws; no
DB/network/crypto side effects.

## Failure modes & gotchas

- **chars ÷ 4 underestimates dense content.** Code, minified JSON (tool results are
  JSON-heavy here), and non-English text — CJK especially, at roughly 1+ token per
  character — can run far above 1 token per 4 chars. The 4,000-token safety buffer is
  the only slack; a systematic underestimate means "fits by our math" requests that the
  API rejects at 400. This is hotspot row 13's second verify item.
- **`image`/`file` parts are a flat 1,000 tokens.** Roughly right for API-native
  images, but a large PDF `file` block can cost far more; several attachments make the
  estimate optimistic in the same direction. (Interaction with file/image blocks is
  otherwise benign — Phase 1 never truncates them, and grouping treats them like any
  other part.)
- **No hard guarantee of fitting.** An oversized last group (or a single-group
  conversation) is sent over budget with no error raised locally — see
  `truncateMessages` above. The user experiences a failed chat turn, not a trimmed one.
- **History loss is silent to the user.** The truncation note is injected *into the
  prompt* — the model is told N groups were omitted, but no flag reaches the response
  stream or UI, so the user only finds out if the assistant happens to mention it. The
  DB history is intact (trimming is per-request), so nothing is permanently lost — but
  the model's apparent "amnesia" has no visible explanation.
- **Trimming mutates tool-result *types*:** oversized `json`/`error-json` outputs come
  back as `text`/`error-text`. Any downstream code branching on output type sees a
  different shape after Phase 1.
- **Synthesized tool-results use the v4-era `result` key, not `output`** (detail under
  `ensureToolResultPairing`) — the file's own estimator scores them as 0 tokens, and
  the AI SDK v6 shape expects `output`. Latent-bug candidate.
- **Pairing check is adjacent-only, add-only:** results more than one message after
  their call would be double-answered (duplicate `toolCallId`s → API error), and
  orphaned results are never removed. Both depend on message shapes that may not occur
  in practice — flagged, not observed.
- **Dormant options:** `keepFirstUserMessage` is never passed by the only caller. If it
  were enabled and group 0 is a lone user message, the synthetic note would produce two
  consecutive `user` messages (SDK merging may or may not absorb this — untested).

## Open questions for the code owner

1. Is chars ÷ 4 plus a 4,000-token buffer accurate enough in practice, given the
   JSON-heavy tool results this app produces? Any observed 400s from context overflow?
   (Hotspot row 13.)
2. The synthesized placeholder in `ensureToolResultPairing` uses `result:` where the
   AI SDK v6 (and the rest of this file) uses `output:` — does the SDK accept this
   shape, and does the placeholder text actually reach the model? (Statically it looks
   like the payload is dropped.)
3. Can tool-results appear inside `user`-role messages at this point in the pipeline
   (the repair pass checks for them)? If yes, Phase 2's group boundary can strand
   orphaned tool-results at the head of the kept tail — confirm or rule out.
4. Is "send it over budget and let the API 400" the intended behavior when the current
   exchange alone exceeds the budget, or should there be a phase 3 / user-facing error?
5. Should the user be told (in the UI or stream metadata) when earlier history was
   omitted from a turn?
6. `keepFirstUserMessage` and four of the seven exports are unused by the app — kept
   deliberately (tests/future use), or removable surface?

## Both-apps note

**Fab only.** Verified at the pinned commit: no `context-window*` file exists anywhere
under `admin_athena/`, and no Admin file imports `context-window` or
`fitMessagesToContextWindow`. Admin's chat pipeline has no equivalent trimming module —
its only "truncation" logic is SQL result-row capping in `admin-tools.ts` /
`error-audit.ts` / `prompt-audit.ts`, which is unrelated. This matches the catalog's
Fab-only placement.
