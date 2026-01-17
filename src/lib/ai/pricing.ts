import type { ModelKey, ModelMetadata } from './providers/types';
import { modelRegistry } from './providers/registry';

export type ModelPriceSnapshot = Readonly<{
  providerId?: string | null;
  modelKey?: string | null;
  modelId?: string | null;
  inputUsdPer1m: number | null;
  outputUsdPer1m: number | null;
  cacheCreationInputUsdPer1m: number | null;
  cacheReadInputUsdPer1m: number | null;
  currency: 'USD';
  source: 'provider' | 'config' | 'missing';
  effectiveAt: string | null;
}>;

type ProviderPricing = Readonly<{
  inputUsdPer1m: number;
  outputUsdPer1m: number;
  cacheCreationInputUsdPer1m?: number;
  cacheReadInputUsdPer1m?: number;
  effectiveAt?: string;
}>;

const readProviderPrice = (_modelKey?: string | null): ProviderPricing | undefined => {
  return undefined;
};

const findMetadata = (modelKey?: string | null): ModelMetadata | undefined => {
  if (modelKey && modelRegistry.has(modelKey as ModelKey)) {
    return modelRegistry.getMetadata(modelKey as ModelKey);
  }
  return undefined;
};

export const getModelPriceSnapshot = (params: {
  modelKey?: string | null;
}): ModelPriceSnapshot => {
  const providerPrice = readProviderPrice(params.modelKey ?? null);
  const providerId = params.modelKey?.split('.')[0] ?? null;

  if (providerPrice) {
    return {
      providerId,
      modelKey: params.modelKey ?? null,
      modelId: null,
      inputUsdPer1m: providerPrice.inputUsdPer1m,
      outputUsdPer1m: providerPrice.outputUsdPer1m,
      cacheCreationInputUsdPer1m: providerPrice.cacheCreationInputUsdPer1m ?? null,
      cacheReadInputUsdPer1m: providerPrice.cacheReadInputUsdPer1m ?? null,
      currency: 'USD',
      source: 'provider',
      effectiveAt: providerPrice.effectiveAt ?? null,
    };
  }

  const metadata = findMetadata(params.modelKey);
  const pricing = metadata?.pricing;
  if (pricing) {
    return {
      providerId: metadata?.providerId ?? providerId,
      modelKey: metadata?.key ?? params.modelKey ?? null,
      modelId: metadata?.modelId ?? null,
      inputUsdPer1m: pricing.inputUsdPer1m,
      outputUsdPer1m: pricing.outputUsdPer1m,
      cacheCreationInputUsdPer1m: pricing.cacheCreationInputUsdPer1m ?? null,
      cacheReadInputUsdPer1m: pricing.cacheReadInputUsdPer1m ?? null,
      currency: 'USD',
      source: 'config',
      effectiveAt: pricing.effectiveAt ?? null,
    };
  }

  return {
    providerId,
    modelKey: params.modelKey ?? null,
    modelId: null,
    inputUsdPer1m: null,
    outputUsdPer1m: null,
    cacheCreationInputUsdPer1m: null,
    cacheReadInputUsdPer1m: null,
    currency: 'USD',
    source: 'missing',
    effectiveAt: null,
  };
};
