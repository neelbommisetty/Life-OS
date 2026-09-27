// Export the CSS source of truth for documentation and design tooling.
import { readFile, writeFile } from "node:fs/promises";
const css = await readFile(
  new URL("../src/tokens.css", import.meta.url),
  "utf8",
);
const tokens = Object.fromEntries(
  [...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
    name,
    value.trim(),
  ]),
);
const path = new URL("../../../docs/DESIGN.json", import.meta.url);
const data = {
  schemaVersion: 3,
  title: "Life-OS design system",
  source: "apps/web/src/tokens.css",
  register: "product",
  colorStrategy: "restrained",
  theme: "light",
  palette: "ocean-blue",
  paletteStatus: "final",
  paletteConfirmedOn: "2026-09-25",
  paletteScope: "All Life-OS web slices",
  tokens,
  breakpoints: {
    mobile: "680px",
    compactSidebar: "900px",
    compactContent: "1100px",
  },
  components: {
    Button: {
      source: "apps/web/src/ui.tsx",
      variants: ["primary", "secondary", "destructive"],
      states: ["default", "hover", "focus", "active", "disabled", "pending"],
    },
    IconButton: {
      source: "apps/web/src/ui.tsx",
      requiredProps: ["aria-label"],
      target: "44px",
    },
    Badge: {
      source: "apps/web/src/ui.tsx",
      tones: ["neutral", "accent", "info"],
      interactive: false,
    },
    Modal: {
      source: "apps/web/src/ui.tsx",
      widths: ["28rem", "40rem"],
      primitive: "Radix Dialog",
      returnFocus:
        "Trigger when available; mobile navigation toggle when trigger is in the closed drawer",
    },
    Menu: { source: "apps/web/src/ui.tsx", primitive: "Radix Dropdown Menu" },
    Shell: {
      source: "apps/web/src/Shell.tsx",
      slots: ["sidebar", "children"],
      props: ["title", "description"],
      navigation: ["/todo", "/calendar"],
      mobileFocusTargets: [
        "links",
        "buttons",
        "inputs",
        "selects",
        "textareas",
      ],
    },
  },
};
const serialized = JSON.stringify(data, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== serialized)
    throw new Error(
      "Design tokens are out of sync. Run bun run --cwd apps/web design:tokens.",
    );
  console.log("Design token documentation is in sync.");
} else {
  await writeFile(path, serialized);
  console.log("Updated docs/DESIGN.json from tokens.css.");
}
