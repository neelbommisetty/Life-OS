import * as Sentry from "@sentry/node";

type SpanAttributeValue = string | number | boolean;

function normalizeAttributes(
  attributes: Record<string, SpanAttributeValue | undefined> | undefined,
): Record<string, SpanAttributeValue> | undefined {
  if (!attributes) return undefined;

  const normalized = Object.entries(attributes).reduce<
    Record<string, SpanAttributeValue>
  >((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function hasSentryClient() {
  return Boolean(Sentry.getClient());
}

export async function withSentrySpan<T>(params: {
  name: string;
  op?: string;
  attributes?: Record<string, SpanAttributeValue | undefined>;
  callback: () => Promise<T> | T;
}): Promise<T> {
  if (!hasSentryClient()) {
    return await params.callback();
  }

  return await Sentry.startSpan(
    {
      name: params.name,
      op: params.op ?? "api.step",
      attributes: normalizeAttributes(params.attributes),
    },
    params.callback,
  );
}

export function captureSentryException(
  error: unknown,
  context?: {
    tags?: Record<string, string | undefined>;
    extras?: Record<string, unknown>;
  },
): void {
  if (!hasSentryClient()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        if (value !== undefined) {
          scope.setTag(key, value);
        }
      }
    }

    if (context?.extras) {
      for (const [key, value] of Object.entries(context.extras)) {
        scope.setExtra(key, value);
      }
    }

    Sentry.captureException(error);
  });
}
