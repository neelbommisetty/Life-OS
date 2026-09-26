// Manually run smoke test against the real catalog sources (TMDB, Open
// Library, IGDB) through the shared API (keys stay on the server): runs one whole lookup for a
// medium and a name the way `life <medium> add` would (search, confidence
// rule, detail, availability for LIFE_REGION), then a live availability call
// for the id it settled on, printing each result. Not part of `bun run test`
// (or `node --test`) — it touches the network and the real keys, so it never
// runs unattended and never runs against FakeCatalog. Writes no database,
// title, or log entry; IGDB may refresh its local app-token cache.
//
// Usage (from packages/tools):
//   node scripts/catalog-smoke.ts <medium> <text> [--year n]
//
// <medium> is movie, show, game, or book; <text> is the name to look up.
// Refuses to run without both arguments so it can never fire by accident.

import type { Medium } from "../src/contract.ts";
import { createClient } from "../src/api/client.ts";
import { clientConfig } from "../src/api/config.ts";

const MEDIA = ["movie", "show", "game", "book"] as const;
const [medium, text, ...rest] = process.argv.slice(2);
const yearIndex = rest.indexOf("--year");
const year = yearIndex === -1 ? undefined : Number(rest[yearIndex + 1]);

if (!medium || !text || !(MEDIA as readonly string[]).includes(medium) || (rest.length !== 0 && (rest.length !== 2 || yearIndex !== 0 || !Number.isInteger(year) || year! < 1 || year! > 9999))) {
  console.error("usage: node scripts/catalog-smoke.ts <movie|show|game|book> <text> [--year n]");
  console.error("refusing to run without an explicit medium and text: this calls the real sources with the keys in .env.");
  process.exit(64);
}

async function main(): Promise<void> {
  const client = createClient(await clientConfig(process.env));
  const { region } = await client.info();
  console.error(`catalog-smoke: ${medium} "${text}"${year !== undefined ? ` (${year})` : ""} in ${region}`);

  const resolution = await client.catalog.resolve(medium as Medium, text!, { ...(year !== undefined ? { year } : {}) });
  console.log("resolve:", JSON.stringify(resolution, (key, value: unknown) => (key === "error" && value instanceof Error ? value.message : value), 2));

  if (resolution.outcome === "failed") {
    process.exitCode = 1;
    return;
  }

  const externalId = resolution.outcome === "linked" ? resolution.externalId : resolution.outcome === "candidates" ? resolution.candidates[0]?.externalId : undefined;
  if (externalId === undefined) {
    console.error("catalog-smoke: nothing to ask availability for");
    return;
  }
  const availability = await client.catalog.availability(medium as Medium, externalId);
  console.log("availability:", JSON.stringify(availability, (key, value: unknown) => (key === "error" && value instanceof Error ? value.message : value), 2));
  if (availability.outcome === "failed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
