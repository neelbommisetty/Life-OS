import "server-only";

import { modelRegistry } from "@life-os/ai/providers/registry";
import { PricingCatalog } from "./pricing-catalog";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
// Initialize AI providers and chat services
import "@life-os/ai/init";

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

  const modelCatalog = toModelCatalog();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <Card className="bg-gradient-to-br from-primary/5 via-background to-background">
          <CardHeader>
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">
              Reference
            </CardDescription>
            <CardTitle className="text-4xl font-bold">AI Model Pricing</CardTitle>
            <CardDescription className="mt-2 text-base">
              Current pricing snapshots used for cost calculations and analytics.
            </CardDescription>
          </CardHeader>
        </Card>

        <PricingCatalog models={modelCatalog} />
      </div>
    </main>
  );
}
