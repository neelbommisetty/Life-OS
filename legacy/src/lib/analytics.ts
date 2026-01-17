type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(name: string, properties?: AnalyticsProperties) {
  if (typeof globalThis === "undefined") {
    return;
  }
  const analytics = (globalThis as {
    analytics?: { track?: (event: string, props?: AnalyticsProperties) => void };
    posthog?: { capture?: (event: string, props?: AnalyticsProperties) => void };
    umami?: { track?: (event: string, props?: AnalyticsProperties) => void };
  }) ?? {};

  if (analytics.analytics?.track) {
    analytics.analytics.track(name, properties);
    return;
  }
  if (analytics.posthog?.capture) {
    analytics.posthog.capture(name, properties);
    return;
  }
  if (analytics.umami?.track) {
    analytics.umami.track(name, properties);
  }
}
