import path from "path";
import { defineConfig } from "prisma/config";

// Load .env manually since prisma.config.ts runs before env is loaded
import { config } from "dotenv";
config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"]!,
  },
});
