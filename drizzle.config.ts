import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local Windows workflow: prefer .env.local, which Next.js also reads.
// Existing environment variables (CI/Railway) are preserved because dotenv
// does not override variables that are already defined unless asked to.
config({ path: ".env.local" });
config({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Create .env.local for local development before running Drizzle commands.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
});
