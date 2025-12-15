import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('openai', () => ({
  __esModule: true,
  default: vi.fn(),
}));

import OpenAI from 'openai';
import type { default as OpenAIClient } from 'openai';
import { createOpenAIModel } from '../providers/openai.js';
import { resetProviderDefaults, setOpenAIDefaults } from '../config.js';
const MockOpenAI = OpenAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderDefaults();
});

afterEach(() => {
  resetProviderDefaults();
});

describe('createOpenAIModel', () => {
  it('throws when no API key is configured', () => {
    expect(() => createOpenAIModel('gpt-test')).toThrow(
      'OpenAI API key is not configured. Provide credentials when creating the model or call setOpenAIDefaults() before registering models.',
    );
  });

  it('sends JSON schema requests in JSON mode and returns parsed text', async () => {
    const responsesCreate = vi
      .fn()
      .mockResolvedValue({
        output_text: '',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '{"message":"ok"}',
              },
            ],
          },
        ],
      });
    const client = {
      responses: {
        create: responsesCreate,
      },
    } as unknown as OpenAIClient;
    const schema = {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    } as const;
    setOpenAIDefaults({ apiKey: 'test-key' });

    const model = createOpenAIModel('gpt-json', {}, { client });

    const result = await model.call({
      prompt: 'Return JSON',
      mode: 'json',
      jsonSchema: schema,
    });

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-json',
        input: 'Return JSON',
        text: {
          format: {
            type: 'json_schema',
            name: 'response',
            schema,
          },
        },
      }),
      undefined,
    );
    expect(result.text).toBe('{"message":"ok"}');
  });

  it('uses stored defaults when instantiating a client without options', () => {
    setOpenAIDefaults({ apiKey: 'test-key' });

    MockOpenAI.mockReturnValue({
      responses: {
        create: vi.fn(),
      },
    } as unknown as OpenAIClient);

    createOpenAIModel('gpt-test');

    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-key' }),
    );
  });
});
