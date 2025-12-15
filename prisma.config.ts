import { defineConfig } from "prisma/config";

export default defineConfig({
  datasource: {
    url: { fromEnvVar: "DATABASE_URL" },
  },
});

