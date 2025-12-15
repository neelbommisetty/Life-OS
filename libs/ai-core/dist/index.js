import { createLogger } from '@writers-block/logger';
import { zodToJsonSchema } from 'zod-to-json-schema';

const applyMiddleware = (model, ...middlewares) => {
    const boundCall = model.call.bind(model);
    const call = middlewares.reduceRight((next, middleware) => middleware(next, model), boundCall);
    return {
        name: model.name,
        caps: model.caps,
        call,
    };
};
const withRetry = (options = {}) => {
    const { retries = 2, delayMs = 0, shouldRetry = () => true, } = options;
    return (next) => async (input) => {
        let attempt = 0;
        while (true) {
            try {
                return await next(input);
            }
            catch (error) {
                if (attempt >= retries || !shouldRetry(error, attempt + 1)) {
                    throw error;
                }
                const delay = typeof delayMs === 'function' ? delayMs(attempt + 1, error) : delayMs;
                if (delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
                attempt += 1;
            }
        }
    };
};
class TimeoutError extends Error {
    constructor(message = 'Model call timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}
const withTimeout = (ms) => {
    if (ms <= 0) {
        throw new Error('Timeout duration must be greater than zero.');
    }
    return (next) => async (input) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new TimeoutError());
        }, ms);
        next(input)
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
};
const withLogging = (options = {}) => {
    const { logger } = options;
    const defaultLogger = createLogger('ai-core:middleware');
    const debug = logger?.debug ?? logger?.info ?? defaultLogger.debug;
    const info = logger?.info ?? defaultLogger.info;
    const error = logger?.error ?? logger?.fatal ?? defaultLogger.error;
    return (next, model) => async (input) => {
        const start = Date.now();
        debug(`Calling model: ${model.name}`, {
            mode: input.mode ?? 'text',
        });
        try {
            const result = await next(input);
            info(`Model ${model.name} succeeded`, {
                mode: input.mode ?? 'text',
                durationMs: Date.now() - start,
            });
            return result;
        }
        catch (err) {
            error(`Model ${model.name} failed`, {
                mode: input.mode ?? 'text',
                durationMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    };
};

const logger = createLogger('ai-core:json');
async function callJson(model, params) {
    if (!model.caps.modes.includes('json')) {
        logger.error('Attempted to call json mode on unsupported model', {
            model: model.name,
            modes: model.caps.modes,
        });
        throw new Error(`Model ${model.name} does not support json mode.`);
    }
    const { prompt, schema, ...rest } = params;
    const jsonSchema = zodToJsonSchema(schema);
    const start = Date.now();
    const schemaType = typeof jsonSchema === 'object' &&
        jsonSchema !== null &&
        'type' in jsonSchema
        ? jsonSchema.type
        : undefined;
    const hasObjectRoot = schemaType === 'object' ||
        (Array.isArray(schemaType) && schemaType.includes('object'));
    if (!hasObjectRoot) {
        const renderedType = Array.isArray(schemaType)
            ? schemaType.join(', ')
            : schemaType ?? 'undefined';
        logger.error('callJson requires object-root schemas', {
            model: model.name,
            schemaType: renderedType,
        });
        throw new Error(`callJson requires schemas to resolve to an object root type. Received: ${renderedType}.`);
    }
    const result = await model.call({
        ...rest,
        prompt,
        mode: 'json',
        jsonSchema,
    });
    let parsed;
    try {
        parsed = JSON.parse(result.text);
    }
    catch (error) {
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

export { TimeoutError, applyMiddleware, callJson, withLogging, withRetry, withTimeout };
//# sourceMappingURL=index.js.map
