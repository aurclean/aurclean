import fs from "fs";
import path from "path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  console.log("Connected to PostgreSQL database.");

  const migrationPath = path.join(
    process.cwd(),
    "prisma/migrations/20260929062955_multi_tenant_foundation/migration.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf-8");

  console.log("Applying multi-tenant migration...");
  try {
    await client.query(sql);
    console.log("Successfully applied multi-tenant migration!");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await client.end();
  }
}

main();
