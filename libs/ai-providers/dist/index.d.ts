import { JsonSchema7Type } from 'zod-to-json-schema';
import OpenAI, { ClientOptions } from 'openai';
import Anthropic, { ClientOptions as ClientOptions$1 } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
interface Logger {
    readonly trace: (message: string, context?: LogContext) => void;
    readonly debug: (message: string, context?: LogContext) => void;
    readonly info: (message: string, context?: LogContext) => void;
    readonly warn: (message: string, context?: LogContext) => void;
    readonly error: (message: string, context?: LogContext) => void;
    readonly fatal: (message: string, context?: LogContext) => void;
}

interface RetryOptions {
    readonly retries?: number;
    readonly delayMs?: number | ((attempt: number, error: unknown) => number);
    readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}
interface LoggingOptions {
    readonly logger?: Partial<Logger>;
}

/**
 * Enumeration of third-party providers that can supply large language models.
 */
declare enum ProviderId {
    Anthropic = "anthropic",
    Google = "google",
    OpenAI = "openai"
}
/**
 * Normalised tiers describing the relative operating cost for a model.
 */
declare enum CostTier {
    Economy = "economy",
    Standard = "standard",
    Premium = "premium",
    Enterprise = "enterprise"
}
/**
 * Canonical identifiers for the default model definitions in the registry.
 */
declare enum ModelKeyName {
    OpenAIGpt5Mini = "openai.gpt-5-mini",
    OpenAIGpt5 = "openai.gpt-5",
    OpenAIGpt5Pro = "openai.gpt-5-pro",
    OpenAIGpt41Mini = "openai.gpt-4.1-mini",
    OpenAIGpt4oMini = "openai.gpt-4o-mini",
    OpenAIGpt4o = "openai.gpt-4o",
    AnthropicClaude35HaikuLatest = "anthropic.claude-3.5-haiku-latest",
    AnthropicClaude37SonnetLatest = "anthropic.claude-3.7-sonnet-latest",
    AnthropicClaude4SonnetLatest = "anthropic.claude-4-sonnet-latest",
    GoogleGemini20Flash = "google.gemini-2.0-flash",
    GoogleGemini20FlashLite = "google.gemini-2.0-flash-lite",
    GoogleGemini25Flash = "google.gemini-2.5-flash",
    GoogleGemini25FlashLite = "google.gemini-2.5-flash-lite",
    GoogleGemini25Pro = "google.gemini-2.5-pro"
}
/**
 * Canonical identifier for a model definition in the registry.
 */
type ModelKey = `${ProviderId}.${string}`;
/**
 * Capabilities for a model with a normalised cost tier.
 */
type ModelCapabilityMetadata = Omit<ModelCapabilities, 'costTier'> & {
    readonly costTier?: CostTier;
};
/**
 * Metadata describing an individual model entry.
 */
interface ModelMetadata extends ModelCapabilityMetadata {
    readonly key: ModelKey;
    readonly providerId: ProviderId;
    readonly label: string;
    readonly description?: string;
    readonly modelId?: string;
    readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}
interface ModelFactoryOptions {
    /**
     * Optional AbortSignal forwarded to SDK calls so upstream packages can enforce cancellation.
     */
    readonly signal?: AbortSignal;
}
type ModelFactory = (options?: ModelFactoryOptions) => BaseModel;
interface ModelDefinition {
    readonly create: ModelFactory;
    readonly metadata: ModelMetadata;
}

declare class ModelRegistry {
    private readonly models;
    private readonly logger;
    register(definition: ModelDefinition): void;
    registerMany(definitions: Iterable<ModelDefinition>): void;
    get(key: ModelKey): ModelDefinition | undefined;
    getMetadata(key: ModelKey): ModelMetadata | undefined;
    getByProvider(providerId: ProviderId): ModelDefinition[];
    list(): ModelDefinition[];
    listMetadata(): ModelMetadata[];
    has(key: ModelKey): boolean;
    create(key: ModelKey, options?: ModelFactoryOptions): BaseModel;
}
declare const modelRegistry: ModelRegistry;

interface OpenAIModelOverrides {
    readonly maxOutputTokens?: number;
    readonly contextWindow?: number;
    readonly costTier?: CostTier;
    readonly tags?: readonly string[];
    readonly modes?: readonly ModelCallMode[];
    readonly supportsJson?: boolean;
    readonly name?: string;
}
interface OpenAIModelFactoryOptions extends ModelFactoryOptions {
    readonly apiKey?: string;
    readonly client?: OpenAI;
    readonly clientOptions?: ClientOptions;
}
interface OpenAIModelDefinitionConfig extends OpenAIModelOverrides {
    readonly key: `${ProviderId.OpenAI}.${string}`;
    readonly modelId: string;
    readonly label: string;
    readonly description?: string;
    readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}
declare const createOpenAIModel: (model: string, overrides?: OpenAIModelOverrides, options?: OpenAIModelFactoryOptions) => BaseModel;
declare const openAIDefaultModelDefinitions: readonly ModelDefinition[];
declare const registerDefaultOpenAIModels: (registry?: ModelRegistry) => void;

interface AnthropicModelOverrides {
    readonly maxOutputTokens?: number;
    readonly contextWindow?: number;
    readonly costTier?: CostTier;
    readonly tags?: readonly string[];
    readonly modes?: readonly ModelCallMode[];
    readonly supportsJson?: boolean;
    readonly name?: string;
}
interface AnthropicModelFactoryOptions extends ModelFactoryOptions {
    readonly apiKey?: string;
    readonly client?: Anthropic;
    readonly clientOptions?: ClientOptions$1;
}
interface AnthropicModelDefinitionConfig extends AnthropicModelOverrides {
    readonly key: `${ProviderId.Anthropic}.${string}`;
    readonly modelId: string;
    readonly label: string;
    readonly description?: string;
    readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}
declare const createAnthropicModel: (model: string, overrides?: AnthropicModelOverrides, options?: AnthropicModelFactoryOptions) => BaseModel;
declare const anthropicDefaultModelDefinitions: readonly ModelDefinition[];
declare const registerDefaultAnthropicModels: (registry?: ModelRegistry) => void;

interface GeminiModelOverrides {
    readonly maxOutputTokens?: number;
    readonly contextWindow?: number;
    readonly costTier?: CostTier;
    readonly tags?: readonly string[];
    readonly modes?: readonly ModelCallMode[];
    readonly supportsJson?: boolean;
    readonly name?: string;
}
interface GeminiModelFactoryOptions extends ModelFactoryOptions {
    readonly apiKey?: string;
    readonly client?: GoogleGenerativeAI;
}
interface GeminiModelDefinitionConfig extends GeminiModelOverrides {
    readonly key: `${ProviderId.Google}.${string}`;
    readonly modelId: string;
    readonly label: string;
    readonly description?: string;
    readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}
declare const createGeminiModel: (model: string, overrides?: GeminiModelOverrides, options?: GeminiModelFactoryOptions) => BaseModel;
declare const geminiDefaultModelDefinitions: readonly ModelDefinition[];
declare const registerDefaultGeminiModels: (registry?: ModelRegistry) => void;

declare enum ServiceRouteStrategy {
    Static = "static",
    Failover = "failover",
    RoundRobin = "round_robin",
    RotatingFailover = "rotating_failover",
    Capability = "capability"
}
interface RouteOptions {
    readonly retry?: number | RetryOptions;
    readonly logging?: LoggingOptions;
}
interface NormalizedRouteOptions {
    readonly retry?: RetryOptions;
    readonly logging?: LoggingOptions;
}
interface StaticRouteConfig extends RouteOptions {
    readonly strategy: ServiceRouteStrategy.Static;
    readonly model: ModelKey;
}
interface FailoverRouteConfig extends RouteOptions {
    readonly strategy: ServiceRouteStrategy.Failover;
    readonly models: readonly ModelKey[];
}
interface RoundRobinRouteConfig extends RouteOptions {
    readonly strategy: ServiceRouteStrategy.RoundRobin;
    readonly models: readonly ModelKey[];
}
interface RotatingFailoverRouteConfig extends RouteOptions {
    readonly strategy: ServiceRouteStrategy.RotatingFailover;
    readonly models: readonly ModelKey[];
}
interface CapabilityRouteConfig extends RouteOptions {
    readonly strategy: ServiceRouteStrategy.Capability;
    readonly filter: (metadata: ModelMetadata) => boolean;
    readonly candidates?: readonly ModelKey[];
    readonly sort?: (a: ModelMetadata, b: ModelMetadata) => number;
}
type ServiceRouteConfig = StaticRouteConfig | FailoverRouteConfig | RoundRobinRouteConfig | RotatingFailoverRouteConfig | CapabilityRouteConfig;
interface NormalizedStaticRouteConfig extends NormalizedRouteOptions {
    readonly strategy: ServiceRouteStrategy.Static;
    readonly model: ModelKey;
}
interface NormalizedFailoverRouteConfig extends NormalizedRouteOptions {
    readonly strategy: ServiceRouteStrategy.Failover;
    readonly models: readonly ModelKey[];
}
interface NormalizedRoundRobinRouteConfig extends NormalizedRouteOptions {
    readonly strategy: ServiceRouteStrategy.RoundRobin;
    readonly models: readonly ModelKey[];
}
interface NormalizedRotatingFailoverRouteConfig extends NormalizedRouteOptions {
    readonly strategy: ServiceRouteStrategy.RotatingFailover;
    readonly models: readonly ModelKey[];
}
interface NormalizedCapabilityRouteConfig extends NormalizedRouteOptions {
    readonly strategy: ServiceRouteStrategy.Capability;
    readonly filter: (metadata: ModelMetadata) => boolean;
    readonly candidates?: readonly ModelKey[];
    readonly sort?: (a: ModelMetadata, b: ModelMetadata) => number;
}
type NormalizedServiceRouteConfig = NormalizedStaticRouteConfig | NormalizedFailoverRouteConfig | NormalizedRoundRobinRouteConfig | NormalizedRotatingFailoverRouteConfig | NormalizedCapabilityRouteConfig;
declare class ModelRouter {
    private readonly registry;
    private readonly routes;
    private readonly rotationState;
    constructor(registry?: ModelRegistry, routes?: Map<string, NormalizedServiceRouteConfig>);
    registerServiceRoute(serviceName: string, config: ServiceRouteConfig): void;
    getModelFor(serviceName: string, overrideKey?: ModelKey): BaseModel;
    private instantiateModel;
    private applyRouteMiddleware;
    private createFailoverModel;
    private createRotatingFailoverModel;
    private createRoundRobinModel;
    private createCapabilityModel;
    private getMetadataOrThrow;
}
declare const setModelRouterLogLevel: (level: LogLevel) => void;
declare const registerServiceRoute: (serviceName: string, config: ServiceRouteConfig) => void;
declare const getModelFor: (serviceName: string, overrideKey?: ModelKey) => BaseModel;

type OpenAIDefaults = Readonly<{
    apiKey?: string;
    client?: OpenAI;
    clientOptions?: ClientOptions;
}>;
type AnthropicDefaults = Readonly<{
    apiKey?: string;
    client?: Anthropic;
    clientOptions?: ClientOptions$1;
}>;
type GeminiDefaults = Readonly<{
    apiKey?: string;
    client?: GoogleGenerativeAI;
}>;
declare const setOpenAIDefaults: (defaults: OpenAIDefaults | undefined) => void;
declare const getOpenAIDefaults: () => OpenAIDefaults | undefined;
declare const setAnthropicDefaults: (defaults: AnthropicDefaults | undefined) => void;
declare const getAnthropicDefaults: () => AnthropicDefaults | undefined;
declare const setGeminiDefaults: (defaults: GeminiDefaults | undefined) => void;
declare const getGeminiDefaults: () => GeminiDefaults | undefined;
declare const resetProviderDefaults: () => void;

export { CostTier, ModelKeyName, ModelRegistry, ModelRouter, ProviderId, ServiceRouteStrategy, anthropicDefaultModelDefinitions, createAnthropicModel, createGeminiModel, createOpenAIModel, geminiDefaultModelDefinitions, getAnthropicDefaults, getGeminiDefaults, getModelFor, getOpenAIDefaults, modelRegistry, openAIDefaultModelDefinitions, registerDefaultAnthropicModels, registerDefaultGeminiModels, registerDefaultOpenAIModels, registerServiceRoute, resetProviderDefaults, setAnthropicDefaults, setGeminiDefaults, setModelRouterLogLevel, setOpenAIDefaults };
export type { AnthropicDefaults, AnthropicModelDefinitionConfig, AnthropicModelFactoryOptions, AnthropicModelOverrides, CapabilityRouteConfig, FailoverRouteConfig, GeminiDefaults, GeminiModelDefinitionConfig, GeminiModelFactoryOptions, GeminiModelOverrides, ModelCapabilityMetadata, ModelDefinition, ModelFactory, ModelFactoryOptions, ModelKey, ModelMetadata, OpenAIDefaults, OpenAIModelDefinitionConfig, OpenAIModelFactoryOptions, OpenAIModelOverrides, RotatingFailoverRouteConfig, RoundRobinRouteConfig, ServiceRouteConfig, StaticRouteConfig };
