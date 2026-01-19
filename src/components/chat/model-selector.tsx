"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bot, Feather, Gem, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModelOption = {
  key: string;
  label: string;
  provider: string;
  costTier?: string | null;
  description?: string | null;
  supportsStreaming?: boolean;
};

type Props = {
  models: ModelOption[];
  value?: string | null;
  onChange: (modelKey: string | null) => void;
  isLoading?: boolean;
  isUpdating?: boolean;
  errorMessage?: string | null;
  buttonClassName?: string;
};

const PROVIDER_META: Record<
  string,
  { label: string; icon: typeof Sparkles; iconClassName: string }
> = {
  openai: {
    label: "OpenAI",
    icon: Sparkles,
    iconClassName: "text-emerald-500",
  },
  anthropic: {
    label: "Anthropic",
    icon: Feather,
    iconClassName: "text-amber-500",
  },
  google: {
    label: "Google",
    icon: Gem,
    iconClassName: "text-blue-500",
  },
  xai: {
    label: "xAI",
    icon: Bot,
    iconClassName: "text-slate-500",
  },
};

const COST_TIER_META: Record<string, { label: string }> = {
  economy: { label: "Economy" },
  standard: { label: "Standard" },
  premium: { label: "Premium" },
  enterprise: { label: "Enterprise" },
};

const COST_TIER_ORDER: string[] = ["economy", "standard", "premium", "enterprise"];

const getProviderMeta = (providerId: string) =>
  PROVIDER_META[providerId] ?? {
    label: providerId,
    icon: Bot,
    iconClassName: "text-muted-foreground",
  };

const getCostTierMeta = (tier?: string | null) =>
  tier ? COST_TIER_META[tier] : undefined;

export function ModelSelector({
  models,
  value,
  onChange,
  isLoading,
  isUpdating,
  errorMessage,
  buttonClassName,
}: Props) {
  const hasError = Boolean(errorMessage);
  const currentModel = useMemo(
    () => models.find((model) => model.key === value),
    [models, value]
  );

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const tierKey = model.costTier ?? "other";
      const existing = groups.get(tierKey) ?? [];
      existing.push(model);
      groups.set(tierKey, existing);
    }
    const orderIndex = (tier: string) => {
      const index = COST_TIER_ORDER.indexOf(tier);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    return Array.from(groups.entries())
      .sort(([tierA], [tierB]) => orderIndex(tierA) - orderIndex(tierB))
      .map(([tierKey, tierModels]) => ({
        tierKey,
        tierModels,
        meta: getCostTierMeta(tierKey) ?? { label: "Other" },
      }));
  }, [models]);

  const isDisabled = isLoading || isUpdating;
  const isBusy = isLoading || isUpdating;
  const selectedKey = value ?? "auto";
  const currentMeta = currentModel
    ? getProviderMeta(currentModel.provider)
    : null;
  const CurrentIcon = currentMeta?.icon ?? Sparkles;
  const currentIconClassName =
    currentMeta?.iconClassName ?? "text-muted-foreground";

  const handleValueChange = (nextValue: string) => {
    if (nextValue === "auto") {
      onChange(null);
      return;
    }
    onChange(nextValue);
  };

  return (
    <Select
      value={selectedKey}
      onValueChange={handleValueChange}
      disabled={isDisabled}
    >
      <SelectTrigger
        aria-label="Select model"
        title={errorMessage ?? "Select model"}
        className={cn(
          "h-10 w-10 p-0 justify-center border-border bg-background shadow-sm",
          "focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "[&>svg:last-child]:hidden", // Hide the default chevron
          hasError && "border-red-500 text-red-500",
          buttonClassName
        )}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CurrentIcon className={cn("h-4 w-4", currentIconClassName)} />
        )}
        <SelectValue className="hidden">
          {currentModel?.label ?? "Auto routing"}
        </SelectValue>
      </SelectTrigger>

      <SelectContent
        align="end"
        className="w-64 max-h-80"
      >
        {/* Auto option */}
        <SelectGroup>
          <SelectLabel>Auto</SelectLabel>
          <SelectItem value="auto">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="flex flex-col">
                <span className="font-medium">Auto routing</span>
                <span className="text-[10px] text-muted-foreground">
                  Uses default model fallback
                </span>
              </div>
            </div>
          </SelectItem>
        </SelectGroup>

        {/* Grouped models by tier */}
        {groupedModels.map((group) => (
          <SelectGroup key={group.tierKey}>
            <SelectLabel>{group.meta.label}</SelectLabel>
            {group.tierModels.map((model) => {
              const meta = getProviderMeta(model.provider);
              const Icon = meta.icon;
              return (
                <SelectItem key={model.key} value={model.key}>
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", meta.iconClassName)} />
                    <div className="flex flex-col">
                      <span className="font-medium">{model.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {meta.label}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
