"use client";

import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Bot, Feather, Gem, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

  const [open, setOpen] = useState(false);

  const handleValueChange = (nextValue: string) => {
    if (nextValue === "auto") {
      onChange(null);
    } else {
      onChange(nextValue);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isDisabled}
          aria-label="Select model"
          title={errorMessage ?? "Select model"}
          className={cn(
            "h-10 w-10 p-0 justify-center border-border bg-background shadow-sm",
            "focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
            hasError && "border-red-500 text-red-500",
            buttonClassName
          )}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CurrentIcon className={cn("h-4 w-4", currentIconClassName)} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex flex-col gap-4">
          {/* Auto option */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
              Auto
            </div>
            <Button
              type="button"
              variant={selectedKey === "auto" ? "default" : "ghost"}
              className="w-full justify-start h-auto py-3 px-3"
              onClick={() => handleValueChange("auto")}
            >
              <div className="flex items-center gap-3 w-full">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <div className="flex flex-col items-start text-left">
                  <span className="font-medium text-sm">Auto routing</span>
                  <span className="text-[10px] text-muted-foreground">
                    Uses default model fallback
                  </span>
                </div>
              </div>
            </Button>
          </div>

          {/* Grouped models by tier */}
          {groupedModels.map((group, groupIndex) => (
            <div key={group.tierKey} className="flex flex-col gap-2">
              {groupIndex > 0 && <Separator />}
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                {group.meta.label}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {group.tierModels.map((model) => {
                  const meta = getProviderMeta(model.provider);
                  const Icon = meta.icon;
                  const isSelected = value === model.key;
                  return (
                    <Button
                      key={model.key}
                      type="button"
                      variant={isSelected ? "default" : "ghost"}
                      className="w-full justify-start h-auto py-2.5 px-2.5 flex-col items-start"
                      onClick={() => handleValueChange(model.key)}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isSelected
                              ? "text-primary-foreground"
                              : meta.iconClassName
                          )}
                        />
                        <span className="font-medium text-xs truncate flex-1 text-left">
                          {model.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground w-full text-left mt-0.5">
                        {meta.label}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
