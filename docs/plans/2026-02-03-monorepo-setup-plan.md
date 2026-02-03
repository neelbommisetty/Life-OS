# Monorepo Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the repository into a Bun workspaces monorepo with `apps/web` (Next.js) and `apps/ios` while keeping the web app functional from its new location.

**Architecture:** Move the Next.js app and its configs into `apps/web`, add a workspace root `package.json`, and keep Prisma and app-specific configs with the web app. Root becomes a thin workspace orchestrator.

**Tech Stack:** Bun workspaces, Next.js 16 App Router, TypeScript, Prisma.

### Task 1: Create workspace root and web package manifest

**Files:**
- Modify: `package.json`
- Create: `apps/web/package.json`

**Step 1: Draft the new `apps/web/package.json`**

```json
{
  "name": "web",
  "private": true,
  "scripts": {
    "predev": "prisma generate",
    "prebuild": "prisma generate",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.71.2",
    "@fontsource/fira-code": "^5.2.7",
    "@google/generative-ai": "^0.24.1",
    "@neondatabase/auth": "^0.1.0-beta.21",
    "@prisma/adapter-neon": "^7.3.0",
    "@prisma/client": "^7.3.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.562.0",
    "next": "16.1.5",
    "next-themes": "^0.4.6",
    "openai": "^6.17.0",
    "prisma": "^7.3.0",
    "radix-ui": "^1.4.3",
    "react": "19.2.3",
    "react-dnd": "^16.0.1",
    "react-dnd-html5-backend": "^16.0.1",
    "react-dom": "19.2.3",
    "react-markdown": "^10.1.0",
    "rehype-highlight": "^7.0.2",
    "rehype-raw": "^7.0.0",
    "rehype-sanitize": "^6.0.0",
    "remark-breaks": "^4.0.0",
    "remark-gfm": "^4.0.1",
    "shadcn": "^3.7.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.4.0",
    "tw-animate-css": "^1.4.0",
    "zod": "^4.3.6",
    "zod-to-json-schema": "^3.25.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.18",
    "@tailwindcss/typography": "^0.5.19",
    "@types/bun": "latest",
    "@types/node": "^20.19.30",
    "@types/react": "^19.2.10",
    "@types/react-dom": "^19.2.3",
    "babel-plugin-react-compiler": "1.0.0",
    "dotenv": "^16.4.7",
    "eslint": "^9.39.2",
    "eslint-config-next": "16.1.3",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.9.3"
  },
  "type": "module"
}
```

**Step 2: Update root `package.json` to be workspace-only**

```json
{
  "name": "life-os",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "bun --filter web dev",
    "build": "bun --filter web build",
    "start": "bun --filter web start",
    "lint": "bun --filter web lint",
    "prisma:generate": "bun --filter web prisma:generate",
    "prisma:migrate": "bun --filter web prisma:migrate",
    "prisma:deploy": "bun --filter web prisma:deploy"
  }
}
```

**Step 3: Run lint and tests to ensure nothing breaks**

Run: `bun --filter web lint`
Expected: Pass or report existing issues

Run: `bun --filter web test`
Expected: All existing tests pass

### Task 2: Move the Next.js app into `apps/web`

**Files:**
- Move: `src/` -> `apps/web/src/`
- Move: `next.config.ts` -> `apps/web/next.config.ts`
- Move: `postcss.config.mjs` -> `apps/web/postcss.config.mjs`
- Move: `components.json` -> `apps/web/components.json`
- Move: `prisma/` -> `apps/web/prisma/`
- Move: `prisma.config.ts` -> `apps/web/prisma.config.ts`
- Create: `apps/web/next-env.d.ts`

**Step 1: Move the directories/files listed above**

```bash
mkdir -p apps/web
mv src apps/web/src
mv next.config.ts apps/web/next.config.ts
mv postcss.config.mjs apps/web/postcss.config.mjs
mv components.json apps/web/components.json
mv prisma apps/web/prisma
mv prisma.config.ts apps/web/prisma.config.ts
```

**Step 2: Create `apps/web/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
```

**Step 3: Run tests to verify the moved app still works**

Run: `bun --filter web test`
Expected: All existing tests pass

### Task 3: Update TypeScript and tool configs for new paths

**Files:**
- Create: `apps/web/tsconfig.json`
- Modify: `tsconfig.json`
- Modify: `apps/web/components.json`
- Modify: `apps/web/prisma.config.ts`
- Move: `eslint.config.mjs` -> `apps/web/eslint.config.mjs`

**Step 1: Create `apps/web/tsconfig.json` based on the existing root config**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

**Step 2: Replace root `tsconfig.json` with a minimal workspace config**

```json
{
  "files": [],
  "references": [{ "path": "./apps/web" }]
}
```

**Step 3: Update `apps/web/components.json` Tailwind CSS path**

```json
{
  "tailwind": {
    "css": "apps/web/src/app/globals.css"
  }
}
```

**Step 4: Update `apps/web/prisma.config.ts` schema/migrations paths**

```ts
export default defineConfig({
  schema: "apps/web/prisma/schema.prisma",
  migrations: {
    path: "apps/web/prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
```

**Step 5: Move eslint config into web app**

```bash
mv eslint.config.mjs apps/web/eslint.config.mjs
```

**Step 6: Run lint and tests**

Run: `bun --filter web lint`
Expected: Pass or report existing issues

Run: `bun --filter web test`
Expected: All existing tests pass

### Task 4: Update imports and scripts referencing root paths

**Files:**
- Modify: files referenced by search results in `apps/web/src/**`

**Step 1: Search for root-relative references that need updates**

Run: `rg -n "prisma/|src/|components.json|postcss.config.mjs|next.config.ts" apps/web`
Expected: identify any stale references

**Step 2: Update any stale references to the new `apps/web` paths**

```ts
// Example: update hardcoded prisma paths if any
```

**Step 3: Run tests**

Run: `bun --filter web test`
Expected: All existing tests pass

### Task 5: Verify monorepo dev flow

**Files:**
- None

**Step 1: Run the web dev server from root**

Run: `bun dev`
Expected: Next.js starts successfully from `apps/web`

**Step 2: Stop the server and run tests again**

Run: `bun --filter web test`
Expected: All existing tests pass
