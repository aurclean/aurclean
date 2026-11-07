import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function setSequence(key, value) {
  await client.query(
    `INSERT INTO "sequences" ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key")
     DO UPDATE SET "value" = GREATEST("sequences"."value", $2), "updatedAt" = NOW()`,
    [key, value]
  );
}

async function main() {
  await client.connect();
  console.log("Connected to database.");

  // 1. Orders
  const orderRes = await client.query('SELECT "orderNumber" FROM orders');
  let maxOrderNum = 0;
  for (const row of orderRes.rows) {
    const num = parseInt(row.orderNumber.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num >= 10000) {
      const offset = num - 10000;
      if (offset > maxOrderNum) maxOrderNum = offset;
    }
  }
  console.log("Found", orderRes.rows.length, "orders. Max sequence offset:", maxOrderNum);
  await setSequence("order", Math.max(maxOrderNum, 100));

  // 2. Garment codes by category prefix
  const garmentRes = await client.query('SELECT "garmentCode" FROM garments');
  const maxByPrefix = {};
  for (const row of garmentRes.rows) {
    if (!row.garmentCode) continue;
    const parts = row.garmentCode.split("-");
    if (parts.length === 2) {
      const prefix = parts[0].toUpperCase();
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num >= 1000) {
        const offset = num - 1000;
        if (!maxByPrefix[prefix] || offset > maxByPrefix[prefix]) {
          maxByPrefix[prefix] = offset;
        }
      }
    }
  }
  console.log("Garment max offsets by prefix:", maxByPrefix);
  for (const [prefix, maxVal] of Object.entries(maxByPrefix)) {
    await setSequence(`garment:${prefix}`, Math.max(maxVal, 100));
  }
  // Ensure default prefixes exist
  const standardPrefixes = ["UW", "LW", "ETH", "FRM", "LIN", "HOM", "OUT", "TR", "DR", "JK", "TS", "BS", "SH", "OT", "SR"];
  for (const p of standardPrefixes) {
    await setSequence(`garment:${p}`, 100);
  }

  // 3. Invoices
  const invRes = await client.query('SELECT "invoiceNumber" FROM invoices');
  let maxInv = 0;
  for (const row of invRes.rows) {
    const num = parseInt(row.invoiceNumber.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > maxInv) maxInv = num;
  }
  await setSequence("invoice", Math.max(maxInv, 100));

  // 4. Payments
  const payRes = await client.query('SELECT "paymentNumber" FROM payments');
  let maxPay = 0;
  for (const row of payRes.rows) {
    const num = parseInt(row.paymentNumber?.replace(/\D/g, "") ?? "", 10);
    if (!isNaN(num) && num > maxPay) maxPay = num;
  }
  await setSequence("payment", Math.max(maxPay, 100));

  // 5. Customers
  const cusRes = await client.query('SELECT "code" FROM customers WHERE "code" IS NOT NULL');
  let maxCus = 0;
  for (const row of cusRes.rows) {
    const num = parseInt(row.code.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > maxCus) maxCus = num;
  }
  await setSequence("customer", Math.max(maxCus, 100));

  // 6. Employees
  const empRes = await client.query('SELECT "employeeCode" FROM users WHERE "employeeCode" IS NOT NULL');
  let maxEmp = 0;
  for (const row of empRes.rows) {
    const num = parseInt(row.employeeCode.replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > maxEmp) maxEmp = num;
  }
  await setSequence("employee", Math.max(maxEmp, 30));

  // 7. Delivery Challans
  const dcRes = await client.query('SELECT "challanNumber" FROM delivery_challans');
  let maxDc = 0;
  for (const row of dcRes.rows) {
    const parts = row.challanNumber.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > maxDc) maxDc = num;
  }
  await setSequence("delivery_challan", Math.max(maxDc, 20));

  // 8. Complaints
  const cmpRes = await client.query('SELECT "complaintNumber" FROM complaints');
  let maxCmp = 0;
  for (const row of cmpRes.rows) {
    const num = parseInt(row.complaintNumber?.replace(/\D/g, "") ?? "", 10);
    if (!isNaN(num) && num > maxCmp) maxCmp = num;
  }
  await setSequence("complaint", Math.max(maxCmp, 20));

  console.log("All sequence counters synchronized successfully!");

  const finalSequences = await client.query('SELECT * FROM sequences ORDER BY key ASC');
  console.table(finalSequences.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
