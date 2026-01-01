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

const formatPrice = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `$${value.toFixed(3)}`;
};

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
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pricing catalog
          </div>
          <h2 className="text-xl font-semibold text-foreground">Model pricing</h2>
          <p className="text-sm text-muted-foreground">
            All prices are per 1M tokens, USD.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([providerId, items]) => (
          <div
            key={providerId}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {PROVIDER_LABELS[providerId] ?? providerId}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2 text-right">Input</th>
                    <th className="px-3 py-2 text-right">Cache read</th>
                    <th className="px-3 py-2 text-right">Cache write</th>
                    <th className="px-3 py-2 text-right">Output</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((model) => (
                    <tr key={model.key} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{model.label}</div>
                        {model.modelId && (
                          <div className="text-xs text-muted-foreground">{model.modelId}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {model.key}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">
                        {formatPrice(model.pricing?.inputUsdPer1m ?? null)}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">
                        {formatPrice(model.pricing?.cacheReadInputUsdPer1m ?? null)}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">
                        {formatPrice(model.pricing?.cacheCreationInputUsdPer1m ?? null)}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">
                        {formatPrice(model.pricing?.outputUsdPer1m ?? null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          ))}
      </div>
    </section>
  );
}
