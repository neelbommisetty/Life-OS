import { Hono } from "hono";

type EnvOverrides = Record<string, string | undefined>;

export function createTestApp(route: Hono) {
  const app = new Hono();
  app.route("/", route);
  return app;
}

export async function requestJson(
  app: Hono,
  path: string,
  init?: RequestInit,
) {
  const response = await app.request(path, init);
  return {
    response,
    body: await response.json(),
  };
}

export async function withEnv<T>(
  overrides: EnvOverrides,
  run: () => Promise<T> | T,
) {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
