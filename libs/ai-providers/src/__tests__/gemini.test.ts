import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@google/generative-ai', () => {
  const SchemaType = {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
  } as const satisfies typeof import('@google/generative-ai')['SchemaType'];

  return {
    GoogleGenerativeAI: vi.fn(),
    SchemaType,
  } satisfies Partial<typeof import('@google/generative-ai')>;
});

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { GoogleGenerativeAI as GeminiClient } from '@google/generative-ai';

import { createGeminiModel } from '../providers/gemini.js';
import { resetProviderDefaults, setGeminiDefaults } from '../config.js';

const MockGoogleGenerativeAI = GoogleGenerativeAI as unknown as ReturnType<typeof vi.fn>;

describe('createGeminiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderDefaults();
  });

  afterEach(() => {
    resetProviderDefaults();
  });

  it('throws when no API key is configured', () => {
    expect(() => createGeminiModel('gemini-test')).toThrow(
      'Google Gemini API key is not configured. Provide credentials when creating the model or call setGeminiDefaults() before registering models.',
    );
  });

  it('sends JSON schema requests in JSON mode and returns parsed text', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => '{"message":"ok"}',
      },
    });

    const client = {
      getGenerativeModel: vi.fn(() => ({
        generateContent,
      })),
    } as unknown as GeminiClient;

    const schema = {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    } as const;

    const model = createGeminiModel('gemini-json', {}, { client });

    const result = await model.call({
      prompt: 'Return JSON',
      mode: 'json',
      jsonSchema: schema,
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Return JSON' }],
          },
        ],
        generationConfig: expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            type: SchemaType.OBJECT,
            properties: {
              message: expect.objectContaining({ type: SchemaType.STRING }),
            },
            required: ['message'],
          }),
        }),
      }),
      undefined,
    );
    expect(result.text).toBe('{"message":"ok"}');
  });

  it('uses stored defaults when instantiating a client without options', () => {
    setGeminiDefaults({ apiKey: 'test-key' });

    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => 'ok',
      },
    });

    const getGenerativeModel = vi.fn(() => ({
      generateContent,
    }));

    MockGoogleGenerativeAI.mockReturnValue({
      getGenerativeModel,
    });

    createGeminiModel('gemini-2.5-pro');

    expect(MockGoogleGenerativeAI).toHaveBeenCalledWith('test-key');
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-2.5-pro' });
  });
});
