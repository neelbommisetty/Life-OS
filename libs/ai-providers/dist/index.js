import { createLogger, setLogLevel } from '@writers-block/logger';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { withLogging, withRetry, applyMiddleware } from '@writers-block/ai-core';

/**
 * Enumeration of third-party providers that can supply large language models.
 */
var ProviderId;
(function (ProviderId) {
    ProviderId["Anthropic"] = "anthropic";
    ProviderId["Google"] = "google";
    ProviderId["OpenAI"] = "openai";
})(ProviderId || (ProviderId = {}));
/**
 * Normalised tiers describing the relative operating cost for a model.
 */
var CostTier;
(function (CostTier) {
    CostTier["Economy"] = "economy";
    CostTier["Standard"] = "standard";
    CostTier["Premium"] = "premium";
    CostTier["Enterprise"] = "enterprise";
})(CostTier || (CostTier = {}));
/**
 * Canonical identifiers for the default model definitions in the registry.
 */
var ModelKeyName;
(function (ModelKeyName) {
    ModelKeyName["OpenAIGpt5Mini"] = "openai.gpt-5-mini";
    ModelKeyName["OpenAIGpt5"] = "openai.gpt-5";
    ModelKeyName["OpenAIGpt5Pro"] = "openai.gpt-5-pro";
    ModelKeyName["OpenAIGpt41Mini"] = "openai.gpt-4.1-mini";
    ModelKeyName["OpenAIGpt4oMini"] = "openai.gpt-4o-mini";
    ModelKeyName["OpenAIGpt4o"] = "openai.gpt-4o";
    ModelKeyName["AnthropicClaude35HaikuLatest"] = "anthropic.claude-3.5-haiku-latest";
    ModelKeyName["AnthropicClaude37SonnetLatest"] = "anthropic.claude-3.7-sonnet-latest";
    ModelKeyName["AnthropicClaude4SonnetLatest"] = "anthropic.claude-4-sonnet-latest";
    ModelKeyName["GoogleGemini20Flash"] = "google.gemini-2.0-flash";
    ModelKeyName["GoogleGemini20FlashLite"] = "google.gemini-2.0-flash-lite";
    ModelKeyName["GoogleGemini25Flash"] = "google.gemini-2.5-flash";
    ModelKeyName["GoogleGemini25FlashLite"] = "google.gemini-2.5-flash-lite";
    ModelKeyName["GoogleGemini25Pro"] = "google.gemini-2.5-pro";
})(ModelKeyName || (ModelKeyName = {}));

class ModelRegistry {
    models = new Map();
    logger = createLogger('ai-providers:registry');
    register(definition) {
        const { metadata } = definition;
        if (this.models.has(metadata.key)) {
            throw new Error(`Model "${metadata.key}" has already been registered.`);
        }
        this.logger.debug('Registering model', {
            key: metadata.key,
            providerId: metadata.providerId,
            modes: metadata.modes,
        });
        this.models.set(metadata.key, {
            ...definition,
            metadata: { ...metadata },
        });
    }
    registerMany(definitions) {
        this.logger.debug('Registering batch of models');
        for (const definition of definitions) {
            this.register(definition);
        }
    }
    get(key) {
        return this.models.get(key);
    }
    getMetadata(key) {
        const entry = this.models.get(key);
        return entry?.metadata;
    }
    getByProvider(providerId) {
        return Array.from(this.models.values()).filter((definition) => definition.metadata.providerId === providerId);
    }
    list() {
        return Array.from(this.models.values());
    }
    listMetadata() {
        return Array.from(this.models.values(), (definition) => definition.metadata);
    }
    has(key) {
        return this.models.has(key);
    }
    create(key, options) {
        const definition = this.models.get(key);
        if (!definition) {
            throw new Error(`Model "${key}" has not been registered.`);
        }
        this.logger.debug('Creating model instance', {
            key,
            hasOptions: options !== undefined,
        });
        return definition.create(options);
    }
}
const modelRegistry = new ModelRegistry();

let openAIDefaults;
let anthropicDefaults;
let geminiDefaults;
const logger$1 = createLogger('ai-providers:config');
const cloneOpenAIDefaults = (defaults) => {
    if (!defaults) {
        return undefined;
    }
    const clientOptions = defaults.clientOptions
        ? { ...defaults.clientOptions }
        : undefined;
    return {
        ...defaults,
        clientOptions,
    };
};
const cloneAnthropicDefaults = (defaults) => {
    if (!defaults) {
        return undefined;
    }
    const clientOptions = defaults.clientOptions
        ? { ...defaults.clientOptions }
        : undefined;
    return {
        ...defaults,
        clientOptions,
    };
};
const cloneGeminiDefaults = (defaults) => {
    if (!defaults) {
        return undefined;
    }
    return {
        ...defaults,
    };
};
const setOpenAIDefaults = (defaults) => {
    openAIDefaults = cloneOpenAIDefaults(defaults);
    logger$1.info('Configured OpenAI defaults', {
        hasApiKey: Boolean(defaults?.apiKey ?? defaults?.clientOptions?.apiKey),
        hasClient: defaults?.client !== undefined,
        hasClientOptions: defaults?.clientOptions !== undefined,
    });
};
const getOpenAIDefaults = () => cloneOpenAIDefaults(openAIDefaults);
const setAnthropicDefaults = (defaults) => {
    anthropicDefaults = cloneAnthropicDefaults(defaults);
    logger$1.info('Configured Anthropic defaults', {
        hasApiKey: Boolean(defaults?.apiKey ?? defaults?.clientOptions?.apiKey),
        hasClient: defaults?.client !== undefined,
        hasClientOptions: defaults?.clientOptions !== undefined,
    });
};
const getAnthropicDefaults = () => cloneAnthropicDefaults(anthropicDefaults);
const setGeminiDefaults = (defaults) => {
    geminiDefaults = cloneGeminiDefaults(defaults);
    logger$1.info('Configured Google Gemini defaults', {
        hasApiKey: Boolean(defaults?.apiKey),
        hasClient: defaults?.client !== undefined,
    });
};
const getGeminiDefaults = () => cloneGeminiDefaults(geminiDefaults);
const resetProviderDefaults = () => {
    openAIDefaults = undefined;
    anthropicDefaults = undefined;
    geminiDefaults = undefined;
    logger$1.warn('Reset provider defaults');
};

const DEFAULT_OPENAI_MODES = ['text', 'json'];
const DEFAULT_JSON_SCHEMA_NAME = 'response';
const ensureOpenAIClient = (options) => {
    const defaults = getOpenAIDefaults();
    if (options?.client) {
        return options.client;
    }
    if (defaults?.client) {
        return defaults.client;
    }
    const clientOptions = {
        ...(defaults?.clientOptions ?? {}),
        ...(options?.clientOptions ?? {}),
    };
    const apiKey = options?.apiKey ?? clientOptions.apiKey ?? defaults?.apiKey ?? defaults?.clientOptions?.apiKey;
    if (!apiKey) {
        throw new Error('OpenAI API key is not configured. Provide credentials when creating the model or call setOpenAIDefaults() before registering models.');
    }
    clientOptions.apiKey = apiKey;
    return new OpenAI(clientOptions);
};
const isObject$1 = (value) => typeof value === 'object' && value !== null;
const readOutputText = (value) => {
    if (!isObject$1(value)) {
        return undefined;
    }
    const type = typeof value.type === 'string' ? value.type : undefined;
    if (type !== 'output_text') {
        return undefined;
    }
    const textValue = value.text;
    return typeof textValue === 'string' ? textValue : undefined;
};
const extractResponseText$1 = (response) => {
    const directText = response.output_text;
    if (typeof directText === 'string' && directText.length > 0) {
        return directText;
    }
    const textChunks = [];
    for (const item of response.output ?? []) {
        if (!isObject$1(item)) {
            continue;
        }
        if (item.type === 'message') {
            const contentEntries = Array.isArray(item.content) ? item.content : [];
            for (const content of contentEntries) {
                const text = readOutputText(content);
                if (typeof text === 'string') {
                    textChunks.push(text);
                }
            }
        }
        else {
            const text = readOutputText(item);
            if (typeof text === 'string') {
                textChunks.push(text);
            }
        }
    }
    if (textChunks.length === 0) {
        throw new Error('OpenAI response did not include text content.');
    }
    return textChunks.join('');
};
const createOpenAIModel = (model, overrides = {}, options) => {
    const client = ensureOpenAIClient(options);
    const resolvedModes = (overrides.modes ?? DEFAULT_OPENAI_MODES);
    const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
    const maxOutputTokens = overrides.maxOutputTokens;
    return {
        name: overrides.name ?? model,
        caps: {
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens,
            contextWindow: overrides.contextWindow,
            costTier: overrides.costTier,
            tags: resolvedTags,
        },
        async call(input) {
            const mode = input.mode ?? 'text';
            if (!resolvedModes.includes(mode)) {
                throw new Error(`Mode "${mode}" is not supported by OpenAI model "${model}". Supported modes: ${resolvedModes.join(', ')}.`);
            }
            if (mode === 'json' && !supportsJson) {
                throw new Error(`OpenAI model "${model}" is not configured to support JSON responses.`);
            }
            const request = {
                model,
                input: input.prompt,
            };
            if (maxOutputTokens !== undefined) {
                request.max_output_tokens = maxOutputTokens;
            }
            if (mode === 'json') {
                const schema = (input.jsonSchema ?? { type: 'object' });
                request.text = {
                    format: {
                        type: 'json_schema',
                        name: DEFAULT_JSON_SCHEMA_NAME,
                        schema,
                    },
                };
            }
            const response = await client.responses.create(request, input.signal ? { signal: input.signal } : undefined);
            const text = extractResponseText$1(response);
            return { text };
        },
    };
};
const createOpenAIModelDefinition = (config) => {
    const resolvedModes = (config.modes ?? DEFAULT_OPENAI_MODES);
    const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = config.tags ? [...config.tags] : undefined;
    return {
        metadata: {
            key: config.key,
            providerId: ProviderId.OpenAI,
            label: config.label,
            description: config.description,
            modelId: config.modelId,
            releaseStage: config.releaseStage,
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens: config.maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
        },
        create: ((options) => createOpenAIModel(config.modelId, {
            maxOutputTokens: config.maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
            modes: resolvedModes,
            supportsJson,
            name: config.label,
        }, options)),
    };
};
const DEFAULT_OPENAI_MODEL_CONFIGS = [
    {
        key: ModelKeyName.OpenAIGpt5Mini,
        modelId: 'gpt-5-mini',
        label: 'OpenAI GPT-5 Mini',
        description: 'Economy GPT-5 family model tuned for fast, high-volume generations.',
        releaseStage: 'beta',
        maxOutputTokens: 16384,
        contextWindow: 256000,
        costTier: CostTier.Economy,
        tags: ['gpt-5', 'mini', 'responses'],
    },
    {
        key: ModelKeyName.OpenAIGpt5,
        modelId: 'gpt-5',
        label: 'OpenAI GPT-5',
        description: 'General-availability GPT-5 model balancing quality with expansive context.',
        releaseStage: 'ga',
        maxOutputTokens: 32768,
        contextWindow: 512000,
        costTier: CostTier.Premium,
        tags: ['gpt-5', 'responses'],
    },
    {
        key: ModelKeyName.OpenAIGpt5Pro,
        modelId: 'gpt-5-pro',
        label: 'OpenAI GPT-5 Pro',
        description: 'Top-tier GPT-5 SKU offering the largest context window and highest fidelity.',
        releaseStage: 'ga',
        maxOutputTokens: 65536,
        contextWindow: 1000000,
        costTier: CostTier.Enterprise,
        tags: ['gpt-5', 'pro', 'responses'],
    },
    {
        key: ModelKeyName.OpenAIGpt41Mini,
        modelId: 'gpt-4.1-mini',
        label: 'OpenAI GPT-4.1 Mini',
        description: 'Fast, cost-efficient GPT-4.1 family model suitable for iterative prompt work.',
        releaseStage: 'beta',
        maxOutputTokens: 16384,
        contextWindow: 128000,
        costTier: CostTier.Economy,
        tags: ['gpt-4.1', 'mini', 'responses'],
    },
    {
        key: ModelKeyName.OpenAIGpt4oMini,
        modelId: 'gpt-4o-mini',
        label: 'OpenAI GPT-4o Mini',
        description: 'Lightweight GPT-4o variant optimised for speed and structured outputs.',
        releaseStage: 'beta',
        maxOutputTokens: 16384,
        contextWindow: 128000,
        costTier: CostTier.Standard,
        tags: ['gpt-4o', 'mini', 'responses'],
    },
    {
        key: ModelKeyName.OpenAIGpt4o,
        modelId: 'gpt-4o',
        label: 'OpenAI GPT-4o',
        description: 'Flagship GPT-4o model balancing quality and multimodal reasoning.',
        releaseStage: 'ga',
        maxOutputTokens: 16384,
        contextWindow: 128000,
        costTier: CostTier.Premium,
        tags: ['gpt-4o', 'responses'],
    },
];
const openAIDefaultModelDefinitions = DEFAULT_OPENAI_MODEL_CONFIGS.map(createOpenAIModelDefinition);
const registerDefaultOpenAIModels = (registry = modelRegistry) => {
    for (const definition of openAIDefaultModelDefinitions) {
        if (registry.has(definition.metadata.key)) {
            continue;
        }
        registry.register(definition);
    }
};
registerDefaultOpenAIModels();

const DEFAULT_ANTHROPIC_MODES = ['text', 'json'];
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const JSON_RESPONSE_TOOL_NAME = 'structured_json_response';
const JSON_RESPONSE_SYSTEM_PROMPT = 'You are a service that returns structured data. Always call the provided JSON response tool exactly once with your final answer and do not emit plain text outside of the tool response.';
const ensureAnthropicClient = (options) => {
    const defaults = getAnthropicDefaults();
    if (options?.client) {
        return options.client;
    }
    if (defaults?.client) {
        return defaults.client;
    }
    const clientOptions = {
        ...(defaults?.clientOptions ?? {}),
        ...(options?.clientOptions ?? {}),
    };
    const apiKey = options?.apiKey ?? clientOptions.apiKey ?? defaults?.apiKey ?? defaults?.clientOptions?.apiKey;
    if (!apiKey) {
        throw new Error('Anthropic API key is not configured. Provide credentials when creating the model or call setAnthropicDefaults() before registering models.');
    }
    clientOptions.apiKey = apiKey;
    return new Anthropic(clientOptions);
};
const isObject = (value) => typeof value === 'object' && value !== null;
const serialiseJson = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.stringify(value);
    }
    catch {
        return undefined;
    }
};
const readContentBlockText = (block) => {
    if (!isObject(block)) {
        return undefined;
    }
    const type = typeof block.type === 'string' ? block.type : undefined;
    if (type === 'text') {
        const textValue = block.text;
        return typeof textValue === 'string' ? textValue : undefined;
    }
    if (type === 'json') {
        if ('json' in block) {
            return serialiseJson(block.json);
        }
        if ('data' in block) {
            return serialiseJson(block.data);
        }
    }
    if (type === 'tool_use' && 'input' in block) {
        return serialiseJson(block.input);
    }
    if (type === 'tool_result' && 'content' in block) {
        const content = block.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            const textChunks = content
                .map((entry) => readContentBlockText(entry))
                .filter((value) => typeof value === 'string');
            if (textChunks.length > 0) {
                return textChunks.join('');
            }
        }
    }
    if ('text' in block && typeof block.text === 'string') {
        return block.text;
    }
    return undefined;
};
const normaliseToolInputSchema = (schema) => {
    if (isObject(schema)) {
        const { type: _type, ...rest } = schema;
        return {
            type: 'object',
            ...rest,
        };
    }
    return { type: 'object' };
};
const extractResponseText = (message) => {
    const textChunks = [];
    for (const block of message.content ?? []) {
        const text = readContentBlockText(block);
        if (typeof text === 'string' && text.length > 0) {
            textChunks.push(text);
        }
    }
    if (textChunks.length === 0) {
        throw new Error('Anthropic response did not include text content.');
    }
    return textChunks.join('');
};
const createAnthropicModel = (model, overrides = {}, options) => {
    const client = ensureAnthropicClient(options);
    const resolvedModes = (overrides.modes ?? DEFAULT_ANTHROPIC_MODES);
    const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
    const maxOutputTokens = overrides.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    return {
        name: overrides.name ?? model,
        caps: {
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens,
            contextWindow: overrides.contextWindow,
            costTier: overrides.costTier,
            tags: resolvedTags,
        },
        async call(input) {
            const mode = input.mode ?? 'text';
            if (!resolvedModes.includes(mode)) {
                throw new Error(`Mode "${mode}" is not supported by Anthropic model "${model}". Supported modes: ${resolvedModes.join(', ')}.`);
            }
            if (mode === 'json' && !supportsJson) {
                throw new Error(`Anthropic model "${model}" is not configured to support JSON responses.`);
            }
            let request = {
                model,
                messages: [
                    {
                        role: 'user',
                        content: input.prompt,
                    },
                ],
                max_tokens: maxOutputTokens,
            };
            if (mode === 'json') {
                const jsonRequest = {
                    ...request,
                    system: JSON_RESPONSE_SYSTEM_PROMPT,
                    tools: [
                        {
                            name: JSON_RESPONSE_TOOL_NAME,
                            description: 'Return the final structured response for the caller. The tool input must strictly conform to the declared JSON schema.',
                            input_schema: normaliseToolInputSchema(input.jsonSchema),
                        },
                    ],
                    tool_choice: {
                        type: 'tool',
                        name: JSON_RESPONSE_TOOL_NAME,
                    },
                };
                request = jsonRequest;
            }
            const response = await client.messages.create(request, input.signal ? { signal: input.signal } : undefined);
            const text = extractResponseText(response);
            return { text };
        },
    };
};
const createAnthropicModelDefinition = (config) => {
    const resolvedModes = (config.modes ?? DEFAULT_ANTHROPIC_MODES);
    const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = config.tags ? [...config.tags] : undefined;
    const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    return {
        metadata: {
            key: config.key,
            providerId: ProviderId.Anthropic,
            label: config.label,
            description: config.description,
            modelId: config.modelId,
            releaseStage: config.releaseStage,
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
        },
        create: ((options) => createAnthropicModel(config.modelId, {
            maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
            modes: resolvedModes,
            supportsJson,
            name: config.label,
        }, options)),
    };
};
const DEFAULT_ANTHROPIC_MODEL_CONFIGS = [
    {
        key: ModelKeyName.AnthropicClaude35HaikuLatest,
        modelId: 'claude-3-5-haiku-latest',
        label: 'Anthropic Claude 3.5 Haiku',
        description: 'Latest Claude 3.5 Haiku release offering fast, cost-efficient responses with full 200K token context.',
        releaseStage: 'ga',
        maxOutputTokens: 8192,
        contextWindow: 200000,
        costTier: CostTier.Economy,
        tags: ['claude', 'haiku', 'responses', 'economy'],
    },
    {
        key: ModelKeyName.AnthropicClaude37SonnetLatest,
        modelId: 'claude-3-7-sonnet-latest',
        label: 'Anthropic Claude 3.7 Sonnet',
        description: 'Latest Claude 3.7 Sonnet release balancing quality reasoning, coding assistance, and long-context orchestration.',
        releaseStage: 'ga',
        maxOutputTokens: 8192,
        contextWindow: 200000,
        costTier: CostTier.Standard,
        tags: ['claude', 'sonnet', 'responses', 'standard'],
    },
    {
        key: ModelKeyName.AnthropicClaude4SonnetLatest,
        modelId: 'claude-4-sonnet-latest',
        label: 'Anthropic Claude 4 Sonnet',
        description: 'Flagship Claude 4 Sonnet tier delivering premium reasoning depth, reliability, and tool-use orchestration.',
        releaseStage: 'beta',
        maxOutputTokens: 8192,
        contextWindow: 200000,
        costTier: CostTier.Premium,
        tags: ['claude', 'sonnet', 'responses', 'premium', 'next-gen'],
    },
];
const anthropicDefaultModelDefinitions = DEFAULT_ANTHROPIC_MODEL_CONFIGS.map(createAnthropicModelDefinition);
const registerDefaultAnthropicModels = (registry = modelRegistry) => {
    for (const definition of anthropicDefaultModelDefinitions) {
        if (registry.has(definition.metadata.key)) {
            continue;
        }
        registry.register(definition);
    }
};
registerDefaultAnthropicModels();

const DEFAULT_GEMINI_MODES = ['text', 'json'];
const JSON_RESPONSE_MIME_TYPE = 'application/json';
const ensureGeminiClient = (options) => {
    const defaults = getGeminiDefaults();
    if (options?.client) {
        return options.client;
    }
    if (defaults?.client) {
        return defaults.client;
    }
    const apiKey = options?.apiKey ?? defaults?.apiKey;
    if (!apiKey) {
        throw new Error('Google Gemini API key is not configured. Provide credentials when creating the model or call setGeminiDefaults() before registering models.');
    }
    return new GoogleGenerativeAI(apiKey);
};
const isRecord = (value) => typeof value === 'object' && value !== null;
const toSchemaType = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const entries = Object.values(SchemaType);
    const normalised = value.toUpperCase();
    const match = entries.find((entry) => entry === value || entry === normalised);
    return match;
};
const toGeminiResponseSchema = (schema) => {
    if (!schema) {
        return undefined;
    }
    if (!isRecord(schema)) {
        return undefined;
    }
    const base = {};
    const schemaRecord = schema;
    const type = toSchemaType(schemaRecord.type);
    if (type) {
        base.type = type;
    }
    if (typeof schemaRecord.description === 'string') {
        base.description = schemaRecord.description;
    }
    if (schemaRecord.nullable === true) {
        base.nullable = true;
    }
    if (typeof schemaRecord.format === 'string') {
        base.format = schemaRecord.format;
    }
    const enumValues = schemaRecord.enum;
    if (Array.isArray(enumValues) && enumValues.every((value) => typeof value === 'string')) {
        base.enum = [...enumValues];
    }
    if ('example' in schemaRecord) {
        base.example = schemaRecord.example;
    }
    const propertiesValue = schemaRecord.properties;
    if (isRecord(propertiesValue)) {
        const properties = {};
        for (const [key, value] of Object.entries(propertiesValue)) {
            const propertySchema = toGeminiResponseSchema(value);
            if (propertySchema) {
                properties[key] = propertySchema;
            }
        }
        if (Object.keys(properties).length > 0) {
            base.properties = properties;
        }
    }
    const requiredValues = schemaRecord.required;
    if (Array.isArray(requiredValues)) {
        const required = requiredValues.filter((value) => typeof value === 'string');
        if (required.length > 0) {
            base.required = required;
        }
    }
    if ('items' in schemaRecord) {
        const items = schemaRecord.items;
        if (Array.isArray(items)) {
            const first = items[0];
            const itemSchema = toGeminiResponseSchema(first);
            if (itemSchema) {
                base.items = itemSchema;
            }
        }
        else if (items) {
            const itemSchema = toGeminiResponseSchema(items);
            if (itemSchema) {
                base.items = itemSchema;
            }
        }
    }
    return base;
};
const buildGeminiRequest = (prompt, mode, maxOutputTokens, jsonSchema) => {
    const request = {
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }],
            },
        ],
    };
    const generationConfig = {};
    if (maxOutputTokens !== undefined) {
        generationConfig.maxOutputTokens = maxOutputTokens;
    }
    if (mode === 'json') {
        generationConfig.responseMimeType = JSON_RESPONSE_MIME_TYPE;
        const schema = toGeminiResponseSchema(jsonSchema);
        if (schema) {
            generationConfig.responseSchema = schema;
        }
    }
    if (Object.keys(generationConfig).length > 0) {
        request.generationConfig = generationConfig;
    }
    return request;
};
const createGeminiModel = (model, overrides = {}, options) => {
    const client = ensureGeminiClient(options);
    const resolvedModes = (overrides.modes ?? DEFAULT_GEMINI_MODES);
    const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
    const maxOutputTokens = overrides.maxOutputTokens;
    const generativeModel = client.getGenerativeModel({ model });
    return {
        name: overrides.name ?? model,
        caps: {
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens,
            contextWindow: overrides.contextWindow,
            costTier: overrides.costTier,
            tags: resolvedTags,
        },
        async call(input) {
            const mode = input.mode ?? 'text';
            if (!resolvedModes.includes(mode)) {
                throw new Error(`Mode "${mode}" is not supported by Google Gemini model "${model}". Supported modes: ${resolvedModes.join(', ')}.`);
            }
            if (mode === 'json' && !supportsJson) {
                throw new Error(`Google Gemini model "${model}" is not configured to support JSON responses.`);
            }
            const request = buildGeminiRequest(input.prompt, mode, maxOutputTokens, input.jsonSchema);
            const result = await generativeModel.generateContent(request, input.signal ? { signal: input.signal } : undefined);
            const text = result.response.text();
            if (typeof text !== 'string' || text.length === 0) {
                throw new Error('Google Gemini response did not include text content.');
            }
            return { text };
        },
    };
};
const createGeminiModelDefinition = (config) => {
    const resolvedModes = (config.modes ?? DEFAULT_GEMINI_MODES);
    const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
    const resolvedTags = config.tags ? [...config.tags] : undefined;
    return {
        metadata: {
            key: config.key,
            providerId: ProviderId.Google,
            label: config.label,
            description: config.description,
            modelId: config.modelId,
            releaseStage: config.releaseStage,
            modes: resolvedModes,
            supportsJson,
            maxOutputTokens: config.maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
        },
        create: ((options) => createGeminiModel(config.modelId, {
            maxOutputTokens: config.maxOutputTokens,
            contextWindow: config.contextWindow,
            costTier: config.costTier,
            tags: resolvedTags,
            modes: resolvedModes,
            supportsJson,
            name: config.label,
        }, options)),
    };
};
const DEFAULT_GEMINI_MODEL_CONFIGS = [
    {
        key: ModelKeyName.GoogleGemini20Flash,
        modelId: 'gemini-2.0-flash',
        label: 'Google Gemini 2.0 Flash',
        description: 'Latest Gemini 2.0 Flash model optimised for speed with multimodal reasoning.',
        releaseStage: 'experimental',
        maxOutputTokens: 8192,
        contextWindow: 1000000,
        costTier: CostTier.Standard,
        tags: ['gemini-2.0', 'flash'],
    },
    {
        key: ModelKeyName.GoogleGemini20FlashLite,
        modelId: 'gemini-2.0-flash-lite',
        label: 'Google Gemini 2.0 Flash Lite',
        description: 'Lightweight Gemini 2.0 Flash variant favouring cost efficiency.',
        releaseStage: 'experimental',
        maxOutputTokens: 4096,
        contextWindow: 1000000,
        costTier: CostTier.Economy,
        tags: ['gemini-2.0', 'flash-lite'],
    },
    {
        key: ModelKeyName.GoogleGemini25Flash,
        modelId: 'gemini-2.5-flash',
        label: 'Google Gemini 2.5 Flash',
        description: 'Next-generation Gemini 2.5 Flash model for fast multimodal responses.',
        releaseStage: 'beta',
        maxOutputTokens: 8192,
        contextWindow: 1000000,
        costTier: CostTier.Standard,
        tags: ['gemini-2.5', 'flash'],
    },
    {
        key: ModelKeyName.GoogleGemini25FlashLite,
        modelId: 'gemini-2.5-flash-lite',
        label: 'Google Gemini 2.5 Flash Lite',
        description: 'Cost-efficient Gemini 2.5 Flash Lite model for lighter workloads.',
        releaseStage: 'beta',
        maxOutputTokens: 4096,
        contextWindow: 1000000,
        costTier: CostTier.Economy,
        tags: ['gemini-2.5', 'flash-lite'],
    },
    {
        key: ModelKeyName.GoogleGemini25Pro,
        modelId: 'gemini-2.5-pro',
        label: 'Google Gemini 2.5 Pro',
        description: 'Flagship Gemini 2.5 Pro model for advanced reasoning and multimodal workloads.',
        releaseStage: 'beta',
        maxOutputTokens: 8192,
        contextWindow: 2000000,
        costTier: CostTier.Premium,
        tags: ['gemini-2.5', 'pro'],
    },
];
const geminiDefaultModelDefinitions = DEFAULT_GEMINI_MODEL_CONFIGS.map(createGeminiModelDefinition);
const registerDefaultGeminiModels = (registry = modelRegistry) => {
    for (const definition of geminiDefaultModelDefinitions) {
        if (registry.has(definition.metadata.key)) {
            continue;
        }
        registry.register(definition);
    }
};
registerDefaultGeminiModels();

const sharedServiceRoutes = new Map();
const logger = createLogger('ai-providers:router');
var ServiceRouteStrategy;
(function (ServiceRouteStrategy) {
    ServiceRouteStrategy["Static"] = "static";
    ServiceRouteStrategy["Failover"] = "failover";
    ServiceRouteStrategy["RoundRobin"] = "round_robin";
    ServiceRouteStrategy["RotatingFailover"] = "rotating_failover";
    ServiceRouteStrategy["Capability"] = "capability";
})(ServiceRouteStrategy || (ServiceRouteStrategy = {}));
const COST_RANK = {
    [CostTier.Economy]: 0,
    [CostTier.Standard]: 1,
    [CostTier.Premium]: 2,
    [CostTier.Enterprise]: 3,
};
const defaultCapabilitySort = (a, b) => {
    const costRankA = getCostRank(a.costTier);
    const costRankB = getCostRank(b.costTier);
    if (costRankA !== costRankB) {
        return costRankA - costRankB;
    }
    return a.label.localeCompare(b.label);
};
const getCostRank = (tier) => tier === undefined ? Number.POSITIVE_INFINITY : (COST_RANK[tier] ?? Number.POSITIVE_INFINITY);
const normalizeRetryOptions = (retry) => {
    if (typeof retry === 'number') {
        return { retries: retry };
    }
    return retry ? { ...retry } : undefined;
};
const normalizeRouteConfig = (config) => {
    const retry = normalizeRetryOptions(config.retry);
    const logging = config.logging ? { ...config.logging } : undefined;
    switch (config.strategy) {
        case ServiceRouteStrategy.Static: {
            if (!config.model) {
                throw new Error('Static service routes must provide a model key.');
            }
            return {
                strategy: ServiceRouteStrategy.Static,
                model: config.model,
                retry,
                logging,
            };
        }
        case ServiceRouteStrategy.Failover: {
            if (!config.models?.length) {
                throw new Error('Failover service routes must provide at least one model key.');
            }
            return {
                strategy: ServiceRouteStrategy.Failover,
                models: Array.from(config.models),
                retry,
                logging,
            };
        }
        case ServiceRouteStrategy.RoundRobin: {
            if (!config.models?.length) {
                throw new Error('Round robin service routes must provide at least one model key.');
            }
            return {
                strategy: ServiceRouteStrategy.RoundRobin,
                models: Array.from(config.models),
                retry,
                logging,
            };
        }
        case ServiceRouteStrategy.RotatingFailover: {
            if (!config.models?.length) {
                throw new Error('Rotating failover service routes must provide at least one model key.');
            }
            return {
                strategy: ServiceRouteStrategy.RotatingFailover,
                models: Array.from(config.models),
                retry,
                logging,
            };
        }
        case ServiceRouteStrategy.Capability: {
            return {
                strategy: ServiceRouteStrategy.Capability,
                filter: config.filter,
                candidates: config.candidates ? Array.from(config.candidates) : undefined,
                sort: config.sort,
                retry,
                logging,
            };
        }
        default: {
            const exhaustive = config;
            throw new Error(`Unsupported service route strategy: ${exhaustive}`);
        }
    }
};
const deriveSharedCapabilities = (metas) => {
    if (metas.length === 0) {
        return { modes: [] };
    }
    const [first, ...rest] = metas;
    const sharedModes = rest.reduce((acc, meta) => {
        const supported = new Set(meta.modes);
        return acc.filter((mode) => supported.has(mode));
    }, Array.from(first.modes));
    const resolvedModes = sharedModes.length > 0 ? sharedModes : Array.from(first.modes);
    const supportsJson = metas.every((meta) => meta.supportsJson === true);
    const maxOutputTokens = metas.reduce((value, meta) => {
        if (meta.maxOutputTokens === undefined) {
            return value;
        }
        if (value === undefined) {
            return meta.maxOutputTokens;
        }
        return Math.min(value, meta.maxOutputTokens);
    }, undefined);
    const contextWindow = metas.reduce((value, meta) => {
        if (meta.contextWindow === undefined) {
            return value;
        }
        if (value === undefined) {
            return meta.contextWindow;
        }
        return Math.min(value, meta.contextWindow);
    }, undefined);
    const highestCostTier = metas.reduce((value, meta) => {
        if (!meta.costTier) {
            return value;
        }
        if (!value) {
            return meta.costTier;
        }
        return getCostRank(meta.costTier) > getCostRank(value) ? meta.costTier : value;
    }, undefined);
    return {
        modes: resolvedModes,
        supportsJson: supportsJson,
        maxOutputTokens,
        contextWindow,
        costTier: highestCostTier,
    };
};
class ModelRouter {
    registry;
    routes;
    rotationState = new Map();
    constructor(registry = modelRegistry, routes = sharedServiceRoutes) {
        this.registry = registry;
        this.routes = routes;
    }
    registerServiceRoute(serviceName, config) {
        if (!serviceName) {
            throw new Error('Service name must be provided when registering a route.');
        }
        const normalized = normalizeRouteConfig(config);
        this.routes.set(serviceName, normalized);
        this.rotationState.delete(serviceName);
        logger.info('Registered service route', {
            serviceName,
            strategy: normalized.strategy,
            hasLoggingOverride: normalized.logging !== undefined,
            hasRetryOverride: normalized.retry !== undefined,
        });
    }
    getModelFor(serviceName, overrideKey) {
        const route = this.routes.get(serviceName);
        if (!route) {
            logger.error('Attempted to resolve model for unregistered service', { serviceName });
            throw new Error(`No service route registered for "${serviceName}".`);
        }
        if (overrideKey) {
            logger.info('Resolving model override for service', {
                serviceName,
                overrideKey,
            });
            return this.instantiateModel(serviceName, overrideKey, route);
        }
        switch (route.strategy) {
            case ServiceRouteStrategy.Static:
                logger.debug('Resolved static service route', {
                    serviceName,
                    model: route.model,
                });
                return this.instantiateModel(serviceName, route.model, route);
            case ServiceRouteStrategy.Failover:
                return this.createFailoverModel(serviceName, route);
            case ServiceRouteStrategy.RoundRobin:
                return this.createRoundRobinModel(serviceName, route);
            case ServiceRouteStrategy.RotatingFailover:
                return this.createRotatingFailoverModel(serviceName, route);
            case ServiceRouteStrategy.Capability:
                return this.createCapabilityModel(serviceName, route);
            default: {
                const exhaustive = route;
                throw new Error(`Unsupported service route strategy: ${exhaustive}`);
            }
        }
    }
    instantiateModel(serviceName, key, route) {
        const base = this.registry.create(key);
        logger.debug('Instantiated model from registry', {
            serviceName,
            modelKey: key,
            modelName: base.name,
        });
        return this.applyRouteMiddleware(serviceName, base, route);
    }
    applyRouteMiddleware(serviceName, model, route) {
        const loggingOptions = route.logging ?? {};
        const retryOptions = route.retry ?? {};
        const middlewares = [];
        middlewares.push(withLogging(loggingOptions));
        middlewares.push(withRetry(retryOptions));
        logger.debug('Applied middleware to model', {
            serviceName,
            modelName: model.name,
            hasCustomLogger: loggingOptions.logger !== undefined,
            retries: retryOptions.retries ?? 0,
        });
        return applyMiddleware(model, ...middlewares);
    }
    createFailoverModel(serviceName, route) {
        const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
        const caps = deriveSharedCapabilities(metadatas);
        const base = {
            name: `service:${serviceName}:failover`,
            caps,
            call: async (input) => {
                let lastError;
                for (const key of route.models) {
                    try {
                        logger.debug('Attempting failover candidate', {
                            serviceName,
                            modelKey: key,
                        });
                        const model = this.instantiateModel(serviceName, key, route);
                        return await model.call(input);
                    }
                    catch (error) {
                        logger.warn('Failover candidate failed', {
                            serviceName,
                            modelKey: key,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        lastError = error;
                        continue;
                    }
                }
                throw lastError ?? new Error(`All models failed for service "${serviceName}".`);
            },
        };
        return base;
    }
    createRotatingFailoverModel(serviceName, route) {
        const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
        const caps = deriveSharedCapabilities(metadatas);
        const base = {
            name: `service:${serviceName}:rotating_failover`,
            caps,
            call: async (input) => {
                const startingIndex = this.rotationState.get(serviceName) ?? 0;
                const nextIndex = (startingIndex + 1) % route.models.length;
                this.rotationState.set(serviceName, nextIndex);
                let lastError;
                for (let offset = 0; offset < route.models.length; offset += 1) {
                    const candidateIndex = (startingIndex + offset) % route.models.length;
                    const key = route.models[candidateIndex];
                    try {
                        logger.debug('Attempting rotating failover candidate', {
                            serviceName,
                            modelKey: key,
                            startingIndex,
                            candidateIndex,
                        });
                        const model = this.instantiateModel(serviceName, key, route);
                        return await model.call(input);
                    }
                    catch (error) {
                        logger.warn('Rotating failover candidate failed', {
                            serviceName,
                            modelKey: key,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        lastError = error;
                        continue;
                    }
                }
                throw lastError ?? new Error(`All models failed for service "${serviceName}".`);
            },
        };
        return base;
    }
    createRoundRobinModel(serviceName, route) {
        const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
        const caps = deriveSharedCapabilities(metadatas);
        const base = {
            name: `service:${serviceName}:round_robin`,
            caps,
            call: async (input) => {
                const currentIndex = this.rotationState.get(serviceName) ?? 0;
                const nextIndex = (currentIndex + 1) % route.models.length;
                this.rotationState.set(serviceName, nextIndex);
                const key = route.models[currentIndex];
                logger.debug('Selected round robin candidate', {
                    serviceName,
                    modelKey: key,
                    nextIndex,
                });
                const model = this.instantiateModel(serviceName, key, route);
                return model.call(input);
            },
        };
        return base;
    }
    createCapabilityModel(serviceName, route) {
        const candidateMetas = route.candidates
            ? route.candidates.map((key) => this.getMetadataOrThrow(key))
            : this.registry.listMetadata();
        const matches = candidateMetas.filter(route.filter);
        if (matches.length === 0) {
            throw new Error(`No models available for service "${serviceName}" that match the capability filter.`);
        }
        const sorter = route.sort ?? defaultCapabilitySort;
        const [winner] = [...matches].sort(sorter);
        const base = this.registry.create(winner.key);
        logger.info('Selected capability route winner', {
            serviceName,
            modelKey: winner.key,
            label: winner.label,
        });
        return this.applyRouteMiddleware(serviceName, base, route);
    }
    getMetadataOrThrow(key) {
        const metadata = this.registry.getMetadata(key);
        if (!metadata) {
            throw new Error(`Model "${key}" has not been registered.`);
        }
        return metadata;
    }
}
const setModelRouterLogLevel = (level) => {
    setLogLevel(level);
};
const defaultRouter = new ModelRouter();
const registerServiceRoute = (serviceName, config) => {
    defaultRouter.registerServiceRoute(serviceName, config);
};
const getModelFor = (serviceName, overrideKey) => defaultRouter.getModelFor(serviceName, overrideKey);
registerServiceRoute('storySparkGen', {
    strategy: ServiceRouteStrategy.RotatingFailover,
    models: [
        ModelKeyName.OpenAIGpt4oMini,
        ModelKeyName.AnthropicClaude35HaikuLatest,
        ModelKeyName.GoogleGemini25FlashLite,
    ],
    retry: { retries: 2 },
});
registerServiceRoute('storyDraftNextSteps', {
    strategy: ServiceRouteStrategy.RotatingFailover,
    models: [
        ModelKeyName.OpenAIGpt4oMini,
        ModelKeyName.AnthropicClaude37SonnetLatest,
        ModelKeyName.GoogleGemini25Flash,
    ],
    retry: { retries: 2 },
});
registerServiceRoute('storyDraftAdherence', {
    strategy: ServiceRouteStrategy.RotatingFailover,
    models: [
        ModelKeyName.OpenAIGpt4oMini,
        ModelKeyName.AnthropicClaude35HaikuLatest,
        ModelKeyName.GoogleGemini25FlashLite,
    ],
    retry: { retries: 2 },
});

export { CostTier, ModelKeyName, ModelRegistry, ModelRouter, ProviderId, ServiceRouteStrategy, anthropicDefaultModelDefinitions, createAnthropicModel, createGeminiModel, createOpenAIModel, geminiDefaultModelDefinitions, getAnthropicDefaults, getGeminiDefaults, getModelFor, getOpenAIDefaults, modelRegistry, openAIDefaultModelDefinitions, registerDefaultAnthropicModels, registerDefaultGeminiModels, registerDefaultOpenAIModels, registerServiceRoute, resetProviderDefaults, setAnthropicDefaults, setGeminiDefaults, setModelRouterLogLevel, setOpenAIDefaults };
//# sourceMappingURL=index.js.map
