/**
 * AI Library Usage Examples
 *
 * This file demonstrates how to use the AI library in your application.
 * These are examples only and should not be imported directly.
 */

import { z } from 'zod';

import {
  // Core types
  // Middleware
  applyMiddleware,
  withRetry,
  withTimeout,
  withLogging,

  // JSON schema support
  callJson,

  // Provider configuration
  setOpenAIDefaults,
  setAnthropicDefaults,
  setGeminiDefaults,

  // Model registry
  modelRegistry,

  // Router
  registerServiceRoute,
  getModelFor,
  ServiceRouteStrategy,

  // Types
  ModelKeyName,
  CostTier,
} from '@/lib/ai';

// ============================================================================
// Example 1: Configure Providers
// ============================================================================

/**
 * Configure API keys for providers. Do this once at application startup.
 * Usually in a server-side initialization file.
 */
export function configureProviders() {
  // Option 1: Set defaults with API keys (keys are read from env in providers)
  setOpenAIDefaults({ apiKey: process.env.OPENAI_API_KEY });
  setAnthropicDefaults({ apiKey: process.env.ANTHROPIC_API_KEY });
  setGeminiDefaults({ apiKey: process.env.GOOGLE_AI_API_KEY });
}

// ============================================================================
// Example 2: Register Model Providers (Call after configuring)
// ============================================================================

import {
  registerDefaultOpenAIModels,
  registerDefaultAnthropicModels,
  registerDefaultGeminiModels,
} from '@/lib/ai';

/**
 * Register all available models. Do this once after configuring providers.
 */
export function registerAllModels() {
  registerDefaultOpenAIModels();
  registerDefaultAnthropicModels();
  registerDefaultGeminiModels();
}

// ============================================================================
// Example 3: Direct Model Usage
// ============================================================================

/**
 * Use a model directly from the registry.
 */
export async function directModelUsage() {
  // Create a model instance
  const model = modelRegistry.create(ModelKeyName.OpenAIGpt5Mini);

  // Call with text mode (default)
  const textResult = await model.call({
    prompt: 'What is 2 + 2?',
  });
  console.log(textResult.text);

  // Call with JSON mode
  const jsonResult = await model.call({
    prompt: 'Return a JSON object with a "sum" field containing the result of 2 + 2',
    mode: 'json',
    jsonSchema: {
      type: 'object',
      properties: {
        sum: { type: 'number' },
      },
      required: ['sum'],
    },
  });
  console.log(JSON.parse(jsonResult.text));
}

// ============================================================================
// Example 4: Using callJson with Zod Schemas
// ============================================================================

/**
 * Use callJson for type-safe JSON responses with automatic validation.
 */
export async function zodJsonUsage() {
  const model = modelRegistry.create(ModelKeyName.AnthropicClaudeHaiku45);

  // Define a Zod schema
  const TaskSchema = z.object({
    title: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
    dueDate: z.string().optional(),
  });

  // Get type-safe response
  const task = await callJson(model, {
    prompt: 'Generate a task for "Review quarterly report" with high priority',
    schema: TaskSchema,
  });

  // task is fully typed as { title: string; priority: 'low' | 'medium' | 'high'; dueDate?: string }
  console.log(task.title, task.priority);
}

// ============================================================================
// Example 5: Applying Middleware
// ============================================================================

/**
 * Add middleware for retry, timeout, and logging.
 */
export async function middlewareUsage() {
  const baseModel = modelRegistry.create(ModelKeyName.GoogleGemini25Flash);

  // Apply middleware
  const enhancedModel = applyMiddleware(
    baseModel,
    withLogging(), // Log all calls
    withRetry({ retries: 3, delayMs: 1000 }), // Retry up to 3 times
    withTimeout(30000), // 30 second timeout
  );

  const result = await enhancedModel.call({
    prompt: 'Hello!',
  });
  console.log(result.text);
}

// ============================================================================
// Example 6: Service Routes (Recommended for Production)
// ============================================================================

/**
 * Register service routes for different use cases.
 * This provides intelligent routing with failover, round-robin, etc.
 */
export function setupServiceRoutes() {
  // Static route: Always use the same model
  registerServiceRoute('simple-chat', {
    strategy: ServiceRouteStrategy.Static,
    model: ModelKeyName.OpenAIGpt5Mini,
    retry: 2,
  });

  // Failover: Try models in order if one fails
  registerServiceRoute('reliable-generation', {
    strategy: ServiceRouteStrategy.Failover,
    models: [
      ModelKeyName.OpenAIGpt5Mini,
      ModelKeyName.AnthropicClaudeHaiku45,
      ModelKeyName.GoogleGemini25FlashLite,
    ],
    retry: { retries: 2, delayMs: 500 },
  });

  // Round-robin: Distribute load across models
  registerServiceRoute('load-balanced', {
    strategy: ServiceRouteStrategy.RoundRobin,
    models: [
      ModelKeyName.OpenAIGpt5Mini,
      ModelKeyName.AnthropicClaudeHaiku45,
    ],
  });

  // Rotating failover: Round-robin with failover
  registerServiceRoute('balanced-reliable', {
    strategy: ServiceRouteStrategy.RotatingFailover,
    models: [
      ModelKeyName.OpenAIGpt4o,
      ModelKeyName.AnthropicClaudeSonnet45,
      ModelKeyName.GoogleGemini25Flash,
    ],
    retry: 2,
  });

  // Capability-based: Select model based on capabilities
  registerServiceRoute('economy-mode', {
    strategy: ServiceRouteStrategy.Capability,
    filter: (meta) => meta.costTier === CostTier.Economy,
  });
}

/**
 * Use a service route.
 */
export async function useServiceRoute() {
  // Get the model for a service (routing handled automatically)
  const model = getModelFor('reliable-generation');

  const result = await model.call({
    prompt: 'Generate a creative story opening.',
  });

  console.log(result.text);
}

// ============================================================================
// Example 7: Listing Available Models
// ============================================================================

/**
 * List all registered models and their capabilities.
 */
export function listModels() {
  const models = modelRegistry.listMetadata();

  for (const model of models) {
    console.log(`${model.label} (${model.key})`);
    console.log(`  Provider: ${model.providerId}`);
    console.log(`  Cost Tier: ${model.costTier}`);
    console.log(`  Modes: ${model.modes.join(', ')}`);
    console.log(`  Context Window: ${model.contextWindow?.toLocaleString()} tokens`);
    console.log('');
  }
}
