import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type PricingInfo = {
  inputUsdPer1m: number;
  outputUsdPer1m: number;
  cacheCreationInputUsdPer1m?: number;
  cacheReadInputUsdPer1m?: number;
  effectiveAt?: string;
};

type PricingModel = {
  key: string;
  label: string;
  providerId: string;
  modelId?: string | null;
  pricing?: PricingInfo | null;
};

type PricingCatalogProps = {
  models: PricingModel[];
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  xai: "xAI",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-emerald-10 text-emerald-600",
  anthropic: "bg-orange-10 text-orange-600",
  google: "bg-blue-10 text-blue-600",
  xai: "bg-purple-10 text-purple-600",
};

const formatPrice = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `$${value.toFixed(3)}`;
};

const PriceTag = ({ label, value, variant = "default" }: { label: string; value: string; variant?: "default" | "highlight" }) => (
  <div className={cn("flex flex-col gap-0.5", variant === "highlight" && "bg-muted/30 -mx-2 -my-1 px-2 py-1 rounded-xl")}>
    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
    <span className={cn("text-sm font-semibold text-foreground", variant === "highlight" && "text-base")}>{value}</span>
  </div>
);

export function PricingCatalog({ models }: PricingCatalogProps) {
  const grouped = models.reduce<Record<string, PricingModel[]>>((acc, model) => {
    const key = model.providerId;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(model);
    return acc;
  }, {});

  return (
    <section className="space-y-6">
      <CardHeader className="px-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardDescription>Pricing catalog</CardDescription>
            <CardTitle className="text-2xl">Model pricing</CardTitle>
            <CardDescription className="mt-1">
              All prices are per 1M tokens, USD.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <div className="space-y-4">
        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([providerId, items]) => (
            <Card key={providerId} size="sm" className="overflow-hidden">
              <CardHeader className="px-6 pb-3">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className={cn(PROVIDER_COLORS[providerId])}>
                    {PROVIDER_LABELS[providerId] ?? providerId}
                  </Badge>
                  <CardDescription>{items.length} models</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((model) => (
                    <Card key={model.key} className="group/card hover:shadow-md transition-shadow duration-200">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base leading-tight">{model.label}</CardTitle>
                        </div>
                        {model.modelId && (
                          <CardDescription className="text-xs font-mono">
                            {model.modelId}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <PriceTag
                            label="Input"
                            value={formatPrice(model.pricing?.inputUsdPer1m ?? null)}
                            variant="highlight"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <PriceTag
                              label="Cache read"
                              value={formatPrice(model.pricing?.cacheReadInputUsdPer1m ?? null)}
                            />
                            <PriceTag
                              label="Cache write"
                              value={formatPrice(model.pricing?.cacheCreationInputUsdPer1m ?? null)}
                            />
                          </div>
                          <PriceTag
                            label="Output"
                            value={formatPrice(model.pricing?.outputUsdPer1m ?? null)}
                            variant="highlight"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </section>
  );
}
