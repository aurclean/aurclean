import { nextOrderNumber, nextGarmentCode, nextInvoiceNumber } from "../src/lib/sequence";

async function main() {
  const orderNum = await nextOrderNumber();
  const garmentCode = await nextGarmentCode("UW");
  const invoiceNum = await nextInvoiceNumber();

  console.log("Generated Order Number:", orderNum);
  console.log("Generated Garment Code:", garmentCode);
  console.log("Generated Invoice Number:", invoiceNum);
}

main().catch(console.error);
