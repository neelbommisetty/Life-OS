# @writers-block/ai-providers

Foundational provider adapters and routing utilities for the WritersBlock workspace. The
package bridges vendor SDKs (OpenAI, Anthropic, Google Gemini, and future providers) to the lightweight
contracts defined in [`@writers-block/ai-core`](../ai-core/README.md) so every service can work with
`BaseModel` instances instead of bespoke client wrappers.

## Purpose

- Normalise SDK configuration (API keys, base URLs, retry policies) into predictable factory
  options.
- Publish metadata-rich `ModelDefinition` entries that describe each model's capabilities and
  cost tier.
- Provide a shared registry and router so higher-level packages can declare their model needs
  without hardcoding provider-specific logic.

## Configuring providers

The package exposes helpers such as `setOpenAIDefaults`, `setAnthropicDefaults`, and `setGeminiDefaults` for supplying
API keys, base URLs, retry policies, or mocked SDK clients. Call these during your application
bootstrap to centralise configuration and avoid passing credentials throughout your codebase.

For example:

```ts
import { createOpenAIModel, setOpenAIDefaults } from '@writers-block/ai-providers';

setOpenAIDefaults({ apiKey: process.env.OPENAI_API_KEY! });

const model = createOpenAIModel('gpt-5-mini');
```

You can override credentials or inject mocked clients for individual factories by passing `apiKey`
or `client` directly through the factory options, even after calling the defaults helpers.

## Adapter factories

Every provider exposes a `create<Model>Model` helper that returns a concrete `BaseModel` ready to
call:

```ts
import { createOpenAIModel, createAnthropicModel } from '@writers-block/ai-providers';

const textModel = createOpenAIModel('gpt-5-mini');
const jsonModel = createAnthropicModel('claude-3-5-haiku-latest', { supportsJson: true });
```

Factory arguments accept optional overrides to tune metadata (context window, `costTier`,
`tags`, supported modes) and to supply custom SDK clients or options. Each adapter validates the
requested mode before issuing SDK calls and converts response payloads back into the
`ModelCallOutput` shape from `@writers-block/ai-core`.

## Model registry

`@writers-block/ai-providers` exports a `ModelRegistry` singleton (`modelRegistry`) that stores
`ModelDefinition` entries. Definitions bundle a factory with metadata describing the model key,
label, provider, capability fields, and release stage. Helper functions register a curated set of
defaults when the module loads:

- `registerDefaultOpenAIModels()` adds the GPT-5 Mini, GPT-5, GPT-5 Pro, GPT-4.1 Mini, GPT-4o Mini, and GPT-4o definitions.
- `registerDefaultAnthropicModels()` adds the Claude 3.5 Haiku, Claude 3.7 Sonnet, and Claude 4 Sonnet definitions.
- `registerDefaultGeminiModels()` adds the Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 2.5 Flash, and Gemini 2.5 Pro definitions.

You can register custom models at start-up:

```ts
import { CostTier, ProviderId, createOpenAIModel, modelRegistry } from '@writers-block/ai-providers';

modelRegistry.register({
  create: (options) =>
    createOpenAIModel(
      'gpt-5',
      { costTier: CostTier.Premium, supportsJson: true },
      options,
    ),
  metadata: {
    key: 'openai.gpt-5-custom',
    providerId: ProviderId.OpenAI,
    label: 'OpenAI GPT-5 (custom limits)',
    modes: ['text', 'json'],
    supportsJson: true,
    costTier: CostTier.Premium,
  },
});
```

Registry lookups return either metadata (`getMetadata`, `listMetadata`) or fully-instantiated
models via `create` so downstream packages can bind routes without needing to know how the model
is constructed.

## Routing models

The [`ModelRouter`](./src/router.ts) consumes the registry and exposes
`registerServiceRoute(serviceName, config)` plus `getModelFor(serviceName, overrideKey?)`. Route
configs determine how a service should select a model at call time:

- `ServiceRouteStrategy.Static` – always resolve the same model key.
- `ServiceRouteStrategy.Failover` – try models in order until one succeeds, deriving shared
  capability metadata (token limits, supported modes) for the virtual route.
- `ServiceRouteStrategy.RoundRobin` – cycle through a list of model keys for load distribution.
- `ServiceRouteStrategy.RotatingFailover` – rotate which model handles the first attempt while
  failing over to the rest of the list when errors occur.
- `ServiceRouteStrategy.Capability` – filter the registry by metadata and pick the cheapest (by
  `costTier`) matching model, optionally narrowing the candidate set first.

Middleware options (`retry`, `logging`) apply `@writers-block/ai-core`'s `withRetry` and `withLogging` wrappers to
whatever concrete model the router returns. Use the exported `ModelKeyName` enum when you need to
reference the bundled model keys directly.

```ts
import {
  CostTier,
  getModelFor,
  registerServiceRoute,
  ServiceRouteStrategy,
} from '@writers-block/ai-providers';

registerServiceRoute('storyGenerator', {
  strategy: ServiceRouteStrategy.Capability,
  filter: (meta) =>
    meta.supportsJson === true &&
    (meta.costTier === CostTier.Economy || meta.costTier === CostTier.Standard),
  logging: { service: 'story-generator' },
});

const model = getModelFor('storyGenerator');
const response = await model.call({ prompt: 'Generate a JSON outline…', mode: 'json' });
```

## Default service routes

At module load, the router seeds three service routes with differentiated model selection based on task complexity and quality requirements:

### `storySparkGen` (Economy/Standard tier)
Cost-optimized route for story spark generation using a rotating failover strategy:
- `OpenAIGpt4oMini` (Standard tier)
- `AnthropicClaude35HaikuLatest` (Economy tier)
- `GoogleGemini25FlashLite` (Economy tier)

This balances cost and quality for structured content generation tasks.

### `storyDraftAdherence` (Economy tier)
Economy route for adherence evaluation, which performs adequately with smaller models:
- `OpenAIGpt4oMini` (Standard tier)
- `AnthropicClaude35HaikuLatest` (Economy tier)
- `GoogleGemini25FlashLite` (Economy tier)

Adherence evaluation involves straightforward pattern matching and scoring that economy models handle well.

### `storyDraftNextSteps` (Standard tier)
Standard route for next steps generation, requiring higher quality for strategic writing advice:
- `OpenAIGpt4oMini` (Standard tier)
- `AnthropicClaude37SonnetLatest` (Standard tier - upgraded from Haiku)
- `GoogleGemini25Flash` (Standard tier - upgraded from Flash Lite)

Next steps generation benefits from improved reasoning capabilities for providing actionable, contextual writing guidance.

All routes use `RotatingFailover` strategy to balance load across providers while maintaining failover resilience.

```ts
import { getModelFor } from '@writers-block/ai-providers';

const sparkModel = getModelFor('storySparkGen');
const adherenceModel = getModelFor('storyDraftAdherence');
const nextStepsModel = getModelFor('storyDraftNextSteps');
```

Import `{ ModelKeyName }` from `@writers-block/ai-providers` when you need to reference these
canonical keys directly in your own routes.

Override the behaviour by registering your own route during service start-up (call
`registerServiceRoute('serviceName', …)` before the first lookup) or by passing an override model key
into `getModelFor('serviceName', ModelKeyName.AnthropicClaude4SonnetLatest)` or
`getModelFor('serviceName', ModelKeyName.OpenAIGpt5Pro)` when executing a request to opt into premium tiers.
