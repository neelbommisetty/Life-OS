# Chat Context Optimization: Next Steps

## 1. Ship Database Changes
1. Run Prisma migration in target environment:
   - `bun run prisma:deploy`
2. Verify `ChatThreadContext` exists and is writable.
3. Confirm cascade behavior by deleting a test thread and validating related context row deletion.

## 2. Production Readiness Checks
1. Ensure API Sentry env vars are configured:
   - `SENTRY_DSN`
   - `SENTRY_TRACES_SAMPLE_RATE` (start with `1.0`, reduce later if needed)
   - `SENTRY_ENVIRONMENT`
   - `SENTRY_RELEASE`
2. Confirm API boot loads `apps/api/src/instrument.ts` (already wired in `apps/api/src/server.ts`).
3. Confirm chat requests emit spans for:
   - `chat.request.parse_and_validate`
   - `chat.context.thread.resolve`
   - `chat.context.get_or_create`
   - `chat.context.append.user`
   - `chat.context.summarize_if_needed`
   - `chat.model.call` or `chat.model.stream.start`
   - `chat.context.append.assistant`

## 3. Validate Behavior Parity
1. New thread flow:
   - user + assistant messages persist correctly
   - context row created and updated
2. Existing legacy thread flow:
   - lazy backfill occurs once
   - prompt quality remains unchanged
3. Regenerate flow:
   - still constrained to latest assistant message
   - output behavior unchanged
4. Stream error flow:
   - partial assistant save still occurs
   - context append includes interruption marker

## 4. Measure Performance Impact
1. Build a Sentry dashboard for chat stream endpoint with p50/p95:
   - pre-stream steps (all `chat.context.*` + parse/resolve)
   - `chat.model.stream.start` latency
   - request transaction duration
2. Compare before/after for long threads (high message count).
3. Track summary-call frequency and time (`chat.context.summarize_if_needed`, `chat.context.summarize.model_call`).

## 5. Acceptance Criteria
1. TTFT improvement on long threads:
   - p50 improves materially
   - p95 improves and tail spikes reduce
2. Error rate does not regress.
3. No behavioral regressions in message ordering, regenerate semantics, or saved content.

## 6. If Latency Is Still High
1. Move summarization to async/background worker; temporarily clip oldest context under hard token guard.
2. Add prompt/context cache keyed by `(threadId, lastMessageId)`.
3. Optimize auth middleware latency on `/api/chat/stream`.
4. Verify region co-location for API, DB, and model provider.

## 7. Cleanup (After Stable Period)
1. Stop dual-write to legacy `ChatThread.summary`/`summaryUpTo`.
2. Remove legacy read-path dependencies that are no longer needed.
3. Keep Sentry spans as permanent observability baseline.
