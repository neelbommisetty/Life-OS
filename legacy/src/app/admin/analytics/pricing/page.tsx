import "server-only";

import { initializeChatServices } from "@/lib/ai/chat-services";
import { modelRegistry } from "@/lib/ai/providers/registry";
import { PricingCatalog } from "@/app/admin/analytics/pricing-catalog";

export const dynamic = "force-static";

const toModelCatalog = () =>
  modelRegistry
    .listMetadata()
    .map((model) => ({
      key: model.key,
      label: model.label,
      providerId: model.providerId,
      modelId: model.modelId ?? null,
      pricing: model.pricing ?? null,
    }))
    .sort((a, b) => {
      if (a.providerId === b.providerId) {
        return a.label.localeCompare(b.label);
      }
      return a.providerId.localeCompare(b.providerId);
    });

export default function PricingPage() {
  initializeChatServices();

  const modelCatalog = toModelCatalog();

  return (
    <main className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </div>
          <h1 className="text-3xl font-semibold text-foreground">AI Pricing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Current pricing snapshots used for cost rollups.
          </p>
        </div>
      </div>

      <PricingCatalog models={modelCatalog} />
    </main>
  );
}
