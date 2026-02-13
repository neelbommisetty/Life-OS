import * as Sentry from "@sentry/node";

const DEFAULT_API_DSN =
  "https://9b57f774677e1772439743eeba4ecbb6@o4510879407734784.ingest.us.sentry.io/4510879429427200";

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1.0");

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? DEFAULT_API_DSN,
  integrations: [Sentry.honoIntegration()],
  tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 1.0,
  sendDefaultPii: false,
});
