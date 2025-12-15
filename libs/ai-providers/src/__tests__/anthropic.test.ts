import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import type { default as AnthropicClient } from '@anthropic-ai/sdk';
import { createAnthropicModel } from '../providers/anthropic.js';
import { resetProviderDefaults, setAnthropicDefaults } from '../config.js';
const MockAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderDefaults();
});

afterEach(() => {
  resetProviderDefaults();
});

describe('createAnthropicModel', () => {
  it('throws when no API key is configured', () => {
    expect(() => createAnthropicModel('claude-test')).toThrow(
      'Anthropic API key is not configured. Provide credentials when creating the model or call setAnthropicDefaults() before registering models.',
    );
  });

  it('does not inject beta headers when instantiating a client', () => {
    setAnthropicDefaults({ apiKey: 'test-key' });

    MockAnthropic.mockReturnValue({
      messages: {
        create: vi.fn(),
      },
    } as unknown as AnthropicClient);

    createAnthropicModel('claude-beta');

    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
      }),
    );

    const [[options]] = MockAnthropic.mock.calls;
    expect(options?.defaultHeaders).toBeUndefined();
  });

  it('preserves any provided default headers', () => {
    setAnthropicDefaults({ apiKey: 'test-key' });

    MockAnthropic.mockReturnValue({
      messages: {
        create: vi.fn(),
      },
    } as unknown as AnthropicClient);

    createAnthropicModel(
      'claude-beta',
      {},
      { clientOptions: { defaultHeaders: { 'anthropic-beta': 'prompt-caching-beta' } } },
    );

    const [[options]] = MockAnthropic.mock.calls;
    expect(options?.defaultHeaders).toEqual({ 'anthropic-beta': 'prompt-caching-beta' });
  });

  it('sends JSON schema requests in JSON mode and returns parsed text', async () => {
    const messagesCreate = vi
      .fn()
      .mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '{"message":"ok"}',
          },
        ],
      });
    const client = {
      messages: {
        create: messagesCreate,
      },
    } as unknown as AnthropicClient;
    const schema = {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    } as const;
    const model = createAnthropicModel('claude-json', {}, { client });

    const result = await model.call({
      prompt: 'Return JSON',
      mode: 'json',
      jsonSchema: schema,
    });

    expect(messagesCreate).toHaveBeenCalledTimes(1);
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-json',
        messages: [
          {
            role: 'user',
            content: 'Return JSON',
          },
        ],
        max_tokens: 1024,
        system: expect.stringContaining('JSON'),
        tools: [
          expect.objectContaining({
            name: 'structured_json_response',
            input_schema: expect.objectContaining({
              ...schema,
              type: 'object',
            }),
          }),
        ],
        tool_choice: {
          type: 'tool',
          name: 'structured_json_response',
        },
      }),
      undefined,
    );

    const [[requestArg]] = messagesCreate.mock.calls;
    expect(requestArg.response_format).toBeUndefined();
    expect(result.text).toBe('{"message":"ok"}');
  });

  it('uses stored defaults when instantiating a client without options', () => {
    setAnthropicDefaults({ apiKey: 'test-key' });

    MockAnthropic.mockReturnValue({
      messages: {
        create: vi.fn(),
      },
    } as unknown as AnthropicClient);

    createAnthropicModel('claude-test');

    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-key' }),
    );
  });
});
