"use client";

import { Fragment, useMemo } from "react";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from "@headlessui/react";
import {
  Bot,
  Feather,
  Gem,
  Loader2,
  Sparkles,
} from "lucide-react";
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

const COST_TIER_META: Record<string, { label: string; className: string }> = {
  economy: {
    label: "Economy",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  },
  standard: {
    label: "Standard",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  },
  premium: {
    label: "Premium",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  },
  enterprise: {
    label: "Enterprise",
    className:
      "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
  },
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
        meta: getCostTierMeta(tierKey) ?? {
          label: "Unrated",
          className:
            "bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground",
        },
      }));
  }, [models]);

  const isDisabled = isLoading || isUpdating;
  const isBusy = isLoading || isUpdating;
  const selectedKey = value ?? "auto";
  const currentMeta = currentModel ? getProviderMeta(currentModel.provider) : null;
  const CurrentIcon = currentMeta?.icon ?? Sparkles;
  const currentIconClassName = currentMeta?.iconClassName ?? "text-muted-foreground";

  const handleValueChange = (nextValue: string) => {
    if (nextValue === "auto") {
      onChange(null);
      return;
    }
    onChange(nextValue);
  };

  const autoDescription = "Auto routing uses the default model fallback.";
  return (
    <div className="relative">
      <Listbox
        value={selectedKey}
        onChange={handleValueChange}
        disabled={isDisabled}
      >
        <div className="relative">
          <ListboxButton
            aria-label="Select model"
            title={errorMessage ?? "Select model"}
            type="button"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
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
            <span className="sr-only">
              {currentModel?.label ?? "Auto routing"}
            </span>
          </ListboxButton>

          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <ListboxOptions
              anchor="top end"
              className="z-50 mt-2 max-h-96 w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-border bg-popover p-3 shadow-lg ring-1 ring-black/5 focus:outline-none"
            >
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Auto
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    <ListboxOption
                      value="auto"
                      title={autoDescription}
                      className={({ active, selected }) =>
                        cn(
                          "group relative flex h-20 w-20 items-center justify-center rounded-xl border px-1.5 transition",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                          active && "ring-2 ring-primary/30"
                        )
                      }
                    >
                      {({ selected }) => (
                        <div className="flex flex-col items-center">
                          <Sparkles className="h-5 w-5" />
                          <span
                            className={cn(
                              "mt-1 w-full text-center text-[10px] font-medium leading-snug break-words",
                              selected ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            Auto
                          </span>
                        </div>
                      )}
                    </ListboxOption>
                  </div>
                </div>

                {groupedModels.map((group) => (
                  <div key={group.tierKey} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.meta.label}
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {group.tierModels.map((model) => {
                        const meta = getProviderMeta(model.provider);
                        const Icon = meta.icon;
                        return (
                          <ListboxOption
                            key={model.key}
                            value={model.key}
                            title={model.description ?? "No description available."}
                            className={({ active, selected }) =>
                              cn(
                                "group relative flex h-20 w-20 items-center justify-center rounded-xl border px-1.5 transition",
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground",
                                active && "ring-2 ring-primary/30"
                              )
                            }
                          >
                            {({ selected }) => (
                              <div className="flex flex-col items-center">
                                <Icon className={cn("h-5 w-5", meta.iconClassName)} />
                                <span
                                  className={cn(
                                    "mt-1 w-full text-center text-[10px] font-medium leading-snug break-words",
                                    selected ? "text-primary" : "text-muted-foreground"
                                  )}
                                >
                                  {model.label}
                                </span>
                              </div>
                            )}
                          </ListboxOption>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ListboxOptions>
          </Transition>
        </div>
      </Listbox>
    </div>
  );
}
