import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, name, email, role, status, "accessCode" FROM users');
  console.log("Found", res.rows.length, "users:");
  console.table(res.rows);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
