# Chat Context Optimization: Ops Next Steps

This doc reflects the current shipped behavior:
- Non-regenerate chat streaming uses `ChatThreadContext` by default (no feature flag).
- Regenerate requests keep the legacy prompt reconstruction path for safety.
- Summarization compacts `ChatThreadContext.conversationContext` and dual-writes
  legacy `ChatThread.summary` and `ChatThread.summaryUpTo` (compat mode).
- API emits Sentry transactions + spans (request/auth + chat step spans).

## 1. Deploy Checklist
1. Apply the DB migration:
   - `bun run prisma:deploy`
2. Verify the table exists:
   - `ChatThreadContext` row per `ChatThread` (created lazily on first stream).
3. Confirm cascade delete works (delete a test thread and ensure its context row is gone).
4. Verify Sentry bootstrap is executed:
   - `apps/api/src/server.ts` imports `apps/api/src/instrument.ts`.

## 2. Required Environment
1. API Sentry:
   - `SENTRY_DSN` (required to send events)
   - `SENTRY_TRACES_SAMPLE_RATE` (start at `1.0`, then tune down)
   - `SENTRY_ENVIRONMENT` (e.g. `production`)
   - `SENTRY_RELEASE` (deploy identifier)
2. Chat providers:
   - Ensure model provider keys are configured as usual (`OPENAI_API_KEY`, etc.).

## 3. Runtime Verification (Behavior)
1. New thread:
   - USER message saved, assistant streams, assistant saved.
   - `ChatThreadContext` row created and `conversationContext` grows by two turns.
2. Legacy thread (existing messages):
   - First stream request does one-time lazy backfill into `ChatThreadContext`.
   - Subsequent requests do not re-read full message history in the hot path.
3. Regenerate:
   - Still restricted to regenerating the latest assistant message.
   - Uses legacy slicing/prompt assembly path.
4. Stream error path:
   - If partial text exists, assistant message persists with interruption marker.
   - Context append for partial assistant response occurs transactionally.

## 4. Runtime Verification (Sentry Tracing)
1. Confirm transactions exist for `/api/chat/stream` and show spans:
   - `chat.request.parse_and_validate`
   - `chat.context.thread.resolve`
   - `chat.context.get_or_create` (includes lazy backfill when missing)
   - `chat.context.append.user`
   - `chat.context.summarize_if_needed`
   - `chat.context.summarize.model_call` (when summarization runs)
   - `chat.model.call` or `chat.model.stream.start`
   - `chat.context.append.assistant` (or `chat.context.append.assistant_partial`)
2. Confirm auth middleware span exists on protected routes:
   - `auth.resolve_user`

## 5. Performance Validation
1. Primary metric:
   - TTFT for long threads (p50/p95) improves by removing full-history reads.
2. Track these Sentry span timings:
   - `chat.context.get_or_create` (watch for backfill spikes)
   - `chat.context.append.user` / `chat.context.append.assistant`
   - `chat.context.summarize.model_call` (tail latency contributor)
   - `chat.model.stream.start` (provider latency)
3. Watch summary frequency:
   - Summarization should trigger based on `conversationTokenCount`, not full-history scans.

## 6. If TTFT Is Still High (Most Likely Causes)
1. Synchronous summarization still frequently triggers:
   - Make summarization async (worker) and temporarily clip oldest context under a hard
     token guard until the worker compacts it.
2. Provider latency dominates:
   - Compare `chat.model.stream.start` vs pre-stream spans.
   - Consider routing changes or regional alignment (API, DB, provider region).
3. Auth/session resolution dominates:
   - Optimize session lookup caching and any proxy hops around `/api/chat/stream`.

## 7. Follow-Ups (After Stable Period)
1. Remove compat dual-write:
   - Stop writing `ChatThread.summary` and `ChatThread.summaryUpTo`.
2. Optional: optimize regenerate path:
   - Move regenerate onto context table safely (requires correctness work).
3. Add operational tooling:
   - A Sentry dashboard/view focusing on `/api/chat/stream` transactions and the
     `chat.stream.step` spans above.
