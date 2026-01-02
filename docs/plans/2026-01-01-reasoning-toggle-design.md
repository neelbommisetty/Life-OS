# Reasoning Toggle and Storage Design

## Goals
- Tag models that support reasoning output.
- Add a per-thread toggle to enable reasoning; default off.
- When enabled, request reasoning from supported models, stream it live, and store it.
- Show raw reasoning output behind a per-message toggle; fetch lazily for past messages.
- Ensure AI call logging accounts for reasoning tokens and cost when available.

## Non-Goals
- Summarizing reasoning text.
- Exposing reasoning for unsupported models.

## Summary of Changes
- Add `supportsReasoning` to model metadata/capabilities.
- Add `reasoningEnabled` to `ChatThread` (default false).
- Add `ChatMessageReasoning` table for raw reasoning + token metadata.
- Add SSE event type for reasoning deltas during streaming.
- Add lazy reasoning fetch endpoint for past messages.
- Ensure `recordAiCall` includes reasoning usage when provided.

## UX
- Show a "Reasoning" toggle in the chat header only if the selected model supports reasoning.
- Toggle is off by default and persists per thread.
- When model changes, auto-disable `reasoningEnabled` on the thread.
- During streaming, show reasoning output immediately below the assistant message (collapsed by default).
- For past messages, show a per-message toggle that lazy-loads reasoning text.

## Data Model
- `ChatThread.reasoningEnabled: Boolean @default(false)`
- `ChatMessageReasoning` table:
  - `messageId` (unique, FK to ChatMessage)
  - `content` (text)
  - `tokenCount` (int)
  - `tokenCountSource` (string, usage/estimate)
  - timestamps

## Provider Integration
- Extend `ModelCapabilities`/`ModelMetadata` with `supportsReasoning?: boolean`.
- Mark models that can emit reasoning (OpenAI GPT-5 family, xAI Grok reasoning variants, etc.).
- When `thread.reasoningEnabled` is true, pass provider-specific parameters to request reasoning.
- Capture reasoning output in provider adapters for both call and stream paths.

## Streaming
- Introduce SSE event type `reasoning_chunk` with incremental reasoning text.
- Accumulate reasoning in the stream route alongside answer text.
- Save reasoning in `ChatMessageReasoning` when the assistant message is persisted.

## Retrieval
- Keep message list query unchanged (no reasoning join).
- Add a `chat.getMessageReasoning` query to fetch reasoning on toggle expand.
- Cache reasoning client-side after first load.

## Telemetry and Cost
- Extend AI call logging to record reasoning tokens if provided by the provider.
- If no explicit reasoning tokens, estimate from reasoning text length and record source.

## Error Handling
- If reasoning requested but not returned, store null reasoning and show "No reasoning output".
- If reasoning fetch fails, show a non-blocking error state in the reasoning panel.

## Open Questions
- Exact provider fields/events for reasoning across SDKs (to confirm during implementation).

## Next Steps
- Implement schema changes and migrations.
- Update model registry and provider adapters.
- Add UI toggle and reasoning rendering.
- Add lazy reasoning query and cache.
- Update AI telemetry tracking.
