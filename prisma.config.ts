import path from "node:path";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL) {
  try {
    const fs = require("node:fs");
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^\s*([\w_]+)\s*=\s*"?([^"\n]+)"?/);
      if (match && match[1] && match[2]) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // Ignore if .env doesn't exist
  }
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
