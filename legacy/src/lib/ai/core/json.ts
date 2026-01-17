import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { createLogger } from '@/lib/logger';

import type { BaseModel, ModelCallInput } from './core';

export type CallJsonParams<TSchema extends z.ZodTypeAny> = Omit<
  ModelCallInput,
  'mode' | 'jsonSchema'
> & {
  readonly schema: TSchema;
};

const logger = createLogger('ai-core:json');

export async function callJson<TSchema extends z.ZodTypeAny>(
  model: BaseModel,
  params: CallJsonParams<TSchema>
): Promise<z.infer<TSchema>> {
  if (!model.caps.modes.includes('json')) {
    logger.error('Attempted to call json mode on unsupported model', {
      model: model.name,
      modes: model.caps.modes,
    });
    throw new Error(`Model ${model.name} does not support json mode.`);
  }

  const { prompt, schema, ...rest } = params;
  // @ts-expect-error zod-to-json-schema types lag behind zod@4; safe at runtime
  const jsonSchema = zodToJsonSchema(schema);

  const start = Date.now();

  const schemaType =
    typeof jsonSchema === 'object' &&
    jsonSchema !== null &&
    'type' in jsonSchema
      ? (jsonSchema as { type?: unknown }).type
      : undefined;

  const hasObjectRoot =
    schemaType === 'object' ||
    (Array.isArray(schemaType) && schemaType.includes('object'));

  if (!hasObjectRoot) {
    const renderedType = Array.isArray(schemaType)
      ? schemaType.join(', ')
      : schemaType ?? 'undefined';

    logger.error('callJson requires object-root schemas', {
      model: model.name,
      schemaType: renderedType,
    });

    throw new Error(
      `callJson requires schemas to resolve to an object root type. Received: ${renderedType}.`,
    );
  }

  const result = await model.call({
    ...rest,
    prompt,
    mode: 'json',
    jsonSchema,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to parse JSON response', {
      model: model.name,
      error: message,
    });
    throw new Error(`Failed to parse JSON response: ${message}`);
  }

  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    logger.error('JSON response failed schema validation', {
      model: model.name,
      issues: validation.error.issues.map((issue) => issue.message),
    });
    throw validation.error;
  }

  logger.info('Model returned valid JSON payload', {
    model: model.name,
    durationMs: Date.now() - start,
  });

  return validation.data;
}
