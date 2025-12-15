# @writers-block/ai-core

Shared contracts and helpers for integrating large language models (LLMs) into the WritersBlock workspace. The package keeps the
LLM surface area lightweight so higher-level packages can bring their own model clients while still benefiting from consistent
error handling and JSON tooling.

## BaseModel contract

At the heart of the library is the [`BaseModel`](./src/core.ts) interface. Every concrete model adapter must expose:

- `name`: a human-friendly identifier used for logging and error messages.
- `caps`: a [`ModelCapabilities`](./src/core.ts) object that lists the supported call `modes` (currently `"text"` or `"json"`). The capabilities bag also carries optional metadata so callers can make smarter routing decisions.
- `call(input)`: an async method that accepts a [`ModelCallInput`](./src/core.ts) and resolves to a [`ModelCallOutput`](./src/core.ts).

```ts
import type { BaseModel, ModelCallInput, ModelCallOutput } from '@writers-block/ai-core';

class MyModel implements BaseModel {
  readonly name = 'my-llm';
  readonly caps = { modes: ['text', 'json'] } as const;

  async call(input: ModelCallInput): Promise<ModelCallOutput> {
    const response = await myClient.generate({
      prompt: input.prompt,
      mode: input.mode ?? 'text',
      schema: input.jsonSchema,
      signal: input.signal,
    });

    return { text: response.text };
  }
}
```

Adapters can ignore unsupported modes by omitting them from `caps.modes`. Higher-level helpers such as `callJson` (documented below)
will guard against invoking a model in an unsupported mode.

### Capability metadata reference

While the base contract only requires a `name`, supported `modes`, and a `call` implementation, the optional metadata fields on
[`ModelCapabilities`](./src/core.ts) help downstream packages compose richer behaviours:

| Field | Purpose | Typical usage |
| --- | --- | --- |
| `supportsJson` | Indicates whether the provider can reliably honour JSON-structured prompts when the `"json"` mode is requested. | [`callJson`](./src/json.ts) validates this flag before attempting structured responses and the [`@writers-block/ai-providers`](../ai-providers/) router avoids routing JSON workloads to models that cannot satisfy them. |
| `maxOutputTokens` | Approximate ceiling for generated tokens. | `@writers-block/ai-providers` trims per-call budgets when building SDK requests and the router can pick higher-capacity models for longer generations. |
| `contextWindow` | Combined prompt + output token limit. | Capability-based routing can filter for models that accommodate large prompt payloads. |
| `costTier` | Relative operating cost label (for example `"economy"`, `"standard"`, `"premium"`). | The router sorts candidate models to keep failover chains cost-aware and services can expose tier selectors in configuration. |
| `tags` | Arbitrary descriptors describing domain strengths, safety guarantees, or compliance regimes. | Filters can target specialised models (for example `tags` including `"long-form"` or `"safety-high"`). |

Because these values flow through every `BaseModel`, higher-level tooling such as the `@writers-block/ai-providers` registry can combine metadata
from multiple models to calculate shared capabilities for round-robin or failover routes. Populate as many fields as possible so the
wider workspace can make intelligent routing decisions without hardcoding provider-specific knowledge.

## Middleware pipeline

`@writers-block/ai-core` supplies composable middleware to decorate model calls without changing their implementations. Use [`applyMiddleware`](./src/middleware.ts)
with one or more middleware factories to produce a wrapped model that still conforms to `BaseModel`:

```ts
import { applyMiddleware, withLogging, withRetry, withTimeout } from '@writers-block/ai-core';

const modelWithGuards = applyMiddleware(
  myModel,
  withLogging(),
  withRetry({ retries: 3, delayMs: 250 }),
  withTimeout(10_000),
);

await modelWithGuards.call({ prompt: '...' });
```

Available middleware includes:

- `withRetry` – retries failed calls with optional delay and custom retry logic.
- `withTimeout` – rejects calls that exceed a configurable duration by throwing a `TimeoutError`.
- `withLogging` – emits lifecycle events to `console.info` / `console.error` or an injected logger.

Middleware wraps the model's `call` method, so it automatically applies to any helper built on top of the base contract.

## JSON workflows with Zod

When an LLM can honour structured responses, [`callJson`](./src/json.ts) bridges Zod schemas to the model's JSON mode:

1. Accepts a `schema` alongside the prompt and converts it to a JSON Schema using [`zodToJsonSchema`](https://github.com/StefanTerdell/zod-to-json-schema).
2. Ensures the target model advertises support for the `"json"` mode via `model.caps.modes`.
3. Invokes `model.call` with `mode: 'json'` and the generated `jsonSchema`.
4. Parses the text response as JSON and validates it against the original Zod schema. Validation errors bubble up, giving callers precise feedback.

```ts
import { callJson } from '@writers-block/ai-core';
import { z } from 'zod';

const schema = z.object({ title: z.string(), beats: z.array(z.string()) });

const payload = await callJson(myModel, {
  prompt: 'Outline a three-beat mystery premise.',
  schema,
});

// payload: { title: string; beats: string[] }
```

Because the helper enforces both JSON parsing and Zod validation, downstream packages can trust the inferred TypeScript type from the schema
without writing extra runtime guards.
