import { JsonSchema7Type } from 'zod-to-json-schema';
import { z } from 'zod';

type ModelCallMode = 'text' | 'json';
interface ModelCapabilities {
    readonly modes: readonly ModelCallMode[];
    readonly supportsJson?: boolean;
    readonly maxOutputTokens?: number;
    readonly contextWindow?: number;
    readonly costTier?: string;
    readonly tags?: readonly string[];
}
interface ModelCallInput {
    readonly prompt: string;
    readonly mode?: ModelCallMode;
    readonly jsonSchema?: JsonSchema7Type;
    readonly signal?: AbortSignal;
}
interface ModelCallOutput {
    readonly text: string;
}
interface BaseModel {
    readonly name: string;
    readonly caps: ModelCapabilities;
    call(input: ModelCallInput): Promise<ModelCallOutput>;
}

type LogContext = Record<string, unknown>;
interface Logger {
    readonly trace: (message: string, context?: LogContext) => void;
    readonly debug: (message: string, context?: LogContext) => void;
    readonly info: (message: string, context?: LogContext) => void;
    readonly warn: (message: string, context?: LogContext) => void;
    readonly error: (message: string, context?: LogContext) => void;
    readonly fatal: (message: string, context?: LogContext) => void;
}

type Middleware = (next: BaseModel['call'], model: BaseModel) => BaseModel['call'];
declare const applyMiddleware: (model: BaseModel, ...middlewares: Middleware[]) => BaseModel;
interface RetryOptions {
    readonly retries?: number;
    readonly delayMs?: number | ((attempt: number, error: unknown) => number);
    readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}
declare const withRetry: (options?: RetryOptions) => Middleware;
declare class TimeoutError extends Error {
    constructor(message?: string);
}
declare const withTimeout: (ms: number) => Middleware;
interface LoggingOptions {
    readonly logger?: Partial<Logger>;
}
declare const withLogging: (options?: LoggingOptions) => Middleware;

type CallJsonParams<TSchema extends z.ZodTypeAny> = Omit<ModelCallInput, 'mode' | 'jsonSchema'> & {
    readonly schema: TSchema;
};
declare function callJson<TSchema extends z.ZodTypeAny>(model: BaseModel, params: CallJsonParams<TSchema>): Promise<z.infer<TSchema>>;

export { TimeoutError, applyMiddleware, callJson, withLogging, withRetry, withTimeout };
export type { BaseModel, CallJsonParams, LoggingOptions, Middleware, ModelCallInput, ModelCallMode, ModelCallOutput, ModelCapabilities, RetryOptions };
