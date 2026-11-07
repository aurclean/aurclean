/**
 * Development seed.
 *
 * Builds a small but realistic laundry business: a head office, two branches
 * and a central processing unit, a full staff roster covering every role, a
 * priced catalogue, corporate contracts, consumables — and then books real
 * orders and walks a share of their garments through the pipeline so every
 * screen has something truthful to show.
 *
 * Safe to re-run: it clears the transactional tables first.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";
import type {
  GarmentStatus,
  OrderStatus,
  ProcessingStage,
  TrackingCategory,
  UserRole,
} from "../src/generated/prisma/enums";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS } from "../src/lib/rbac";
import { DEFAULT_NOTIFICATION_BODIES } from "../src/lib/notification-templates";
import { categoryForTypeCode, categoryPrefix } from "../src/lib/garment-categories";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 60000,
});

const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) });

/** Matches the fixed default-firm id created by the multi-tenant migration. */
const FIRM_ID = "firm_aurclean_falnir";

async function seedFirm() {
  await prisma.firm.upsert({
    where: { id: FIRM_ID },
    create: {
      id: FIRM_ID,
      code: "FALNIR",
      name: "Aurclean - Falnir",
      status: "ACTIVE",
    },
    update: {},
  });
}

/**
 * A fresh deployment has no way to reach the Firms module otherwise: every
 * firm's own admin is now correctly barred from it, so the very first
 * cross-firm Super Admin (PLATFORM_ADMIN, firmId null by design) has to
 * come from somewhere other than that same UI. Seeded once, idempotently.
 */
async function seedPlatformAdmin() {
  await prisma.user.upsert({
    where: { email: "platform-admin@aurclean.example" },
    create: {
      firmId: null,
      employeeCode: "PLAT0001",
      name: "Platform Super Admin",
      email: "platform-admin@aurclean.example",
      accessCode: "900001",
      role: "PLATFORM_ADMIN",
      branchId: null,
    },
    update: {
      accessCode: "900001",
      role: "PLATFORM_ADMIN",
    },
  });
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness, so repeated seeds produce comparable data.
// ---------------------------------------------------------------------------
let seedState = 20260101;
function random(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const randomInt = (min: number, max: number) =>
  Math.floor(random() * (max - min + 1)) + min;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
/** Clamps a timestamp into the recent past — nothing that already happened
 *  may be dated in the future. */
const pastOnly = (date: Date) => {
  const now = Date.now();
  return date.getTime() > now
    ? new Date(now - randomInt(2, 120) * 60 * 1000)
    : date;
};

const daysAgo = (days: number, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, randomInt(0, 59), 0, 0);
  // Seeding at, say, 03:00 must not put "today at 14:00" in the future.
  return days === 0 ? pastOnly(date) : date;
};

const hoursFrom = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

/** Same as hoursFrom, but for events that have already happened. */
const progressedTo = (date: Date, hours: number) => pastOnly(hoursFrom(date, hours));

const FIRST_NAMES = [
  "Priya", "Rahul", "Ananya", "Vikram", "Meera", "Arjun", "Kavya", "Sanjay",
  "Divya", "Rohan", "Nisha", "Karthik", "Sneha", "Amit", "Pooja", "Farhan",
  "Lakshmi", "Imran", "Shreya", "Gautam", "Ritika", "Naveen", "Aisha", "Manish",
];
const LAST_NAMES = [
  "Sharma", "Nair", "Reddy", "Iyer", "Patel", "Menon", "Rao", "Khan",
  "Desai", "Joshi", "Verma", "Pillai", "Bose", "Kulkarni", "Shetty", "Gupta",
];
const AREAS = [
  "Indiranagar", "Koramangala", "Jayanagar", "Whitefield", "HSR Layout",
  "Malleshwaram", "Rajajinagar", "Banashankari", "Marathahalli", "BTM Layout",
];

const fullName = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
const phone = () => `9${randomInt(100000000, 999999999)}`;

async function clearTransactionalData() {
  // Ordered so that children go before parents; the schema's cascades handle
  // the rest.
  await prisma.notificationLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.complaintAttachment.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.processingHistory.deleteMany();
  await prisma.processingTask.deleteMany();
  await prisma.processingBatch.deleteMany();
  await prisma.garmentStatusHistory.deleteMany();
  await prisma.garmentPhoto.deleteMany();
  await prisma.garment.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.pickup.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.garmentException.deleteMany();
  await prisma.garmentScan.deleteMany();
  await prisma.scanEvent.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.goodsReceiptItem.deleteMany();
  await prisma.goodsReceipt.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.purchaseInvoice.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryStock.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.b2BStatement.deleteMany();
  await prisma.b2BRateCard.deleteMany();
  await prisma.b2BSchedule.deleteMany();
  await prisma.b2BContract.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leave.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.staffProfile.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.sequence.deleteMany();
}

async function seedPermissions() {
  const codes = Object.values(PERMISSIONS);

  for (const code of codes) {
    await prisma.permission.upsert({
      where: { code },
      create: {
        code,
        module: code.split(".")[0],
        description: PERMISSION_DESCRIPTIONS[code] ?? code,
      },
      update: { description: PERMISSION_DESCRIPTIONS[code] ?? code },
    });
  }

  const permissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const idByCode = new Map(permissions.map((entry) => [entry.code, entry.id]));

  await prisma.rolePermission.deleteMany();
  const rows = Object.entries(ROLE_PERMISSIONS).flatMap(([role, granted]) =>
    granted
      .map((code) => idByCode.get(code))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ role: role as UserRole, permissionId })),
  );

  await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
  console.log(`  ${codes.length} permissions, ${rows.length} role grants`);
}

async function seedSettings() {
  const settings = [
    { key: "app_name", value: "Aura Laundry", category: "general" },
    { key: "gst_rate", value: "18", category: "billing" },
    { key: "default_turnaround_hours", value: "48", category: "operations" },
    { key: "low_stock_alerts", value: "true", category: "inventory" },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { firmId_key: { firmId: FIRM_ID, key: setting.key } },
      create: { ...setting, firmId: FIRM_ID },
      update: {},
    });
  }
}

async function seedBranches() {
  const headOffice = await prisma.branch.upsert({
    where: { firmId_code: { firmId: FIRM_ID, code: "HO" } },
    create: {
      firmId: FIRM_ID,
      code: "HO",
      name: "Aura Head Office",
      type: "HEAD_OFFICE",
      addressLine: "4th Floor, Prestige Towers, MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      phone: "08040001000",
      email: "hello@auralaundry.example",
      gstNumber: "29AABCA1234A1Z5",
      openingTime: "09:00",
      closingTime: "19:00",
    },
    update: {},
  });

  const children = [
    {
      code: "BR1",
      name: "Indiranagar Branch",
      type: "BRANCH" as const,
      addressLine: "121, 100 Feet Road, Indiranagar",
      pincode: "560038",
      phone: "08040001001",
    },
    {
      code: "BR2",
      name: "Koramangala Branch",
      type: "BRANCH" as const,
      addressLine: "8th Block, Koramangala",
      pincode: "560095",
      phone: "08040001002",
    },
    {
      code: "CPU",
      name: "Central Processing Unit",
      type: "CENTRAL_PROCESSING_UNIT" as const,
      addressLine: "Plot 44, Peenya Industrial Area",
      pincode: "560058",
      phone: "08040001003",
    },
  ];

  const branches = await Promise.all(
    children.map((child) =>
      prisma.branch.upsert({
        where: { firmId_code: { firmId: FIRM_ID, code: child.code } },
        create: {
          ...child,
          firmId: FIRM_ID,
          parentId: headOffice.id,
          city: "Bengaluru",
          state: "Karnataka",
          gstNumber: "29AABCA1234A1Z5",
          openingTime: "08:00",
          closingTime: "21:00",
        },
        update: {},
      }),
    ),
  );

  console.log(`  ${branches.length + 1} branches`);
  return { headOffice, branch1: branches[0], branch2: branches[1], cpu: branches[2] };
}

async function seedShifts(branchIds: string[]) {
  const existing = await prisma.shift.findMany();
  if (existing.length > 0) return existing;

  const shifts = await Promise.all(
    branchIds.flatMap((branchId) => [
      prisma.shift.create({
        data: { name: "Morning", branchId, startTime: "07:00", endTime: "15:00" },
      }),
      prisma.shift.create({
        data: { name: "Evening", branchId, startTime: "14:00", endTime: "22:00" },
      }),
    ]),
  );
  return shifts;
}

interface SeededUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branchId: string | null;
  employeeCode: string | null;
}

async function seedUsers(branches: {
  headOffice: { id: string };
  branch1: { id: string };
  branch2: { id: string };
  cpu: { id: string };
}) {
  const definitions: {
    employeeCode: string;
    name: string;
    email: string;
    accessCode: string;
    role: UserRole;
    branchId: string | null;
    department?: string;
    designation?: string;
    driver?: { vehicleNumber: string; vehicleType: string; licenseNumber: string };
  }[] = [
    {
      employeeCode: "EMP0001",
      name: "Ravi Anand",
      email: "superadmin@auralaundry.example",
      accessCode: "100001",
      role: "SUPER_ADMIN",
      branchId: branches.headOffice.id,
      department: "Technology",
      designation: "System Administrator",
    },
    {
      employeeCode: "EMP0002",
      name: "Sunita Rao",
      email: "manager@auralaundry.example",
      accessCode: "200001",
      role: "MANAGER",
      branchId: branches.headOffice.id,
      department: "Leadership",
      designation: "Proprietor",
    },
    {
      employeeCode: "EMP0003",
      name: "Deepak Menon",
      email: "manager2@auralaundry.example",
      accessCode: "200002",
      role: "MANAGER",
      branchId: branches.branch1.id,
      department: "Operations",
      designation: "Branch Manager",
    },
    {
      employeeCode: "EMP0004",
      name: "Rekha Pillai",
      email: "manager3@auralaundry.example",
      accessCode: "200003",
      role: "MANAGER",
      branchId: branches.branch2.id,
      department: "Operations",
      designation: "Branch Manager",
    },
    {
      employeeCode: "EMP0013",
      name: "Nandini Bhat",
      email: "accountant@auralaundry.example",
      accessCode: "200004",
      role: "MANAGER",
      branchId: branches.headOffice.id,
      department: "Finance",
      designation: "Accountant",
    },
    {
      employeeCode: "EMP0005",
      name: "Anjali Verma",
      email: "counter@auralaundry.example",
      accessCode: "300001",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Front Desk",
      designation: "Counter Executive",
    },
    {
      employeeCode: "EMP0006",
      name: "Suresh Kumar",
      email: "counter2@auralaundry.example",
      accessCode: "300002",
      role: "SCANNER",
      branchId: branches.branch2.id,
      department: "Front Desk",
      designation: "Counter Executive",
    },
    {
      employeeCode: "EMP0007",
      name: "Mahesh Gowda",
      email: "washing@auralaundry.example",
      accessCode: "300003",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Production",
      designation: "Washing Operator",
    },
    {
      employeeCode: "EMP0008",
      name: "Lalita Devi",
      email: "ironing@auralaundry.example",
      accessCode: "300004",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Production",
      designation: "Ironing Operator",
    },
    {
      employeeCode: "EMP0009",
      name: "Fatima Sheikh",
      email: "qc@auralaundry.example",
      accessCode: "300005",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Quality",
      designation: "Quality Inspector",
    },
    {
      employeeCode: "EMP0010",
      name: "Joseph Dsouza",
      email: "packing@auralaundry.example",
      accessCode: "300006",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Production",
      designation: "Packing Operator",
    },
    {
      employeeCode: "EMP0011",
      name: "Ganesh Naik",
      email: "driver@auralaundry.example",
      accessCode: "300007",
      role: "SCANNER",
      branchId: branches.branch1.id,
      department: "Logistics",
      designation: "Delivery Executive",
      driver: {
        vehicleNumber: "KA-01-AB-4521",
        vehicleType: "Two wheeler",
        licenseNumber: "KA0120190001234",
      },
    },
    {
      employeeCode: "EMP0012",
      name: "Prakash Shetty",
      email: "driver2@auralaundry.example",
      accessCode: "300008",
      role: "SCANNER",
      branchId: branches.branch2.id,
      department: "Logistics",
      designation: "Delivery Executive",
      driver: {
        vehicleNumber: "KA-05-CD-9087",
        vehicleType: "Three wheeler",
        licenseNumber: "KA0520180005678",
      },
    },
    {
      employeeCode: "EMP0014",
      name: "Imtiaz Ali",
      email: "cpu@auralaundry.example",
      accessCode: "300009",
      role: "SCANNER",
      branchId: branches.cpu.id,
      department: "Production",
      designation: "Senior Washing Operator",
    },
  ];

  const users: SeededUser[] = [];

  for (const definition of definitions) {
    const user = await prisma.user.upsert({
      where: { email: definition.email },
      create: {
        firmId: FIRM_ID,
        employeeCode: definition.employeeCode,
        name: definition.name,
        email: definition.email,
        phone: phone(),
        accessCode: definition.accessCode,
        role: definition.role,
        branchId: definition.branchId,
        staffProfile: {
          create: {
            department: definition.department,
            designation: definition.designation,
            dateOfJoining: daysAgo(randomInt(120, 900)),
            monthlySalary: randomInt(18, 65) * 1000,
          },
        },
        ...(definition.driver ? { driver: { create: definition.driver } } : {}),
      },
      update: {
        firmId: FIRM_ID,
        accessCode: definition.accessCode,
        role: definition.role,
        branchId: definition.branchId,
      },
      select: { id: true, name: true, email: true, role: true, branchId: true, employeeCode: true },
    });
    users.push(user);
  }

  // The sequence must not hand out codes that are already taken.
  await prisma.sequence.upsert({
    where: { key: "employee" },
    create: { key: "employee", value: definitions.length },
    update: { value: definitions.length },
  });

  console.log(`  ${users.length} staff accounts, each with its own access code`);
  return users;
}

async function seedCatalogue() {
  const services = [
    {
      code: "WASH-FOLD",
      name: "Wash & Fold",
      pricingMode: "PER_KG" as const,
      basePrice: 90,
      turnaroundHours: 48,
      stages: ["WASHING", "DRYING", "PACKING"] as ProcessingStage[],
      description: "Everyday laundry charged by weight",
    },
    {
      code: "WASH-IRON",
      name: "Wash & Iron",
      pricingMode: "PER_PIECE" as const,
      basePrice: 35,
      turnaroundHours: 48,
      stages: ["WASHING", "DRYING", "IRONING", "PACKING"] as ProcessingStage[],
      description: "Washed, dried and pressed, charged per garment",
    },
    {
      code: "DRY-CLEAN",
      name: "Dry Cleaning",
      pricingMode: "PER_PIECE" as const,
      basePrice: 120,
      turnaroundHours: 72,
      stages: ["WASHING", "DRYING", "IRONING", "PACKING"] as ProcessingStage[],
      description: "Solvent cleaning for delicate and formal wear",
    },
    {
      code: "IRON-ONLY",
      name: "Steam Ironing",
      pricingMode: "PER_PIECE" as const,
      basePrice: 15,
      turnaroundHours: 24,
      stages: ["IRONING", "PACKING"] as ProcessingStage[],
      description: "Pressing only, no wash",
    },
    {
      code: "PREMIUM",
      name: "Premium Care",
      pricingMode: "PER_PIECE" as const,
      basePrice: 220,
      turnaroundHours: 96,
      // Premium is the one route that still runs a formal QC step.
      stages: [
        "WASHING",
        "DRYING",
        "IRONING",
        "QUALITY_CHECK",
        "PACKING",
      ] as ProcessingStage[],
      description: "Hand finishing for sarees, suits and couture",
    },
  ];

  const garmentTypes = [
    { code: "SHIRT", name: "Shirt", category: "UPPER_WEAR" },
    { code: "TSHIRT", name: "T-Shirt", category: "UPPER_WEAR" },
    { code: "PANT", name: "Trousers", category: "LOWER_WEAR" },
    { code: "JEANS", name: "Jeans", category: "LOWER_WEAR" },
    { code: "SAREE", name: "Saree", category: "ETHNIC" },
    { code: "KURTA", name: "Kurta", category: "ETHNIC" },
    { code: "SUIT", name: "Suit", category: "FORMAL" },
    { code: "BLAZER", name: "Blazer", category: "FORMAL" },
    { code: "DRESS", name: "Dress", category: "UPPER_WEAR" },
    { code: "BEDSHEET", name: "Bedsheet", category: "LINEN" },
    { code: "TOWEL", name: "Towel", category: "LINEN" },
    { code: "CURTAIN", name: "Curtain", category: "HOME" },
    { code: "PILLOWCOVER", name: "Pillow Cover", category: "LINEN" },
    { code: "JACKET", name: "Jacket", category: "OUTER_WEAR" },
  ].map((type) => ({ ...type, trackingCategory: categoryForTypeCode(type.code) }));

  const createdServices = await Promise.all(
    services.map((service) =>
      prisma.service.upsert({
        where: { firmId_code: { firmId: FIRM_ID, code: service.code } },
        create: { ...service, firmId: FIRM_ID },
        update: { basePrice: service.basePrice, stages: service.stages },
      }),
    ),
  );

  const createdTypes = await Promise.all(
    garmentTypes.map((type) =>
      prisma.garmentType.upsert({
        where: { firmId_code: { firmId: FIRM_ID, code: type.code } },
        create: { ...type, firmId: FIRM_ID },
        update: { trackingCategory: type.trackingCategory },
      }),
    ),
  );

  // A rate matrix — garment-specific prices beat the service base price.
  const multipliers: Record<string, number> = {
    SHIRT: 1, TSHIRT: 0.9, PANT: 1.2, JEANS: 1.4, SAREE: 2.2, KURTA: 1.1,
    SUIT: 3, BLAZER: 2.4, DRESS: 1.6, BEDSHEET: 1.8, TOWEL: 0.7,
    CURTAIN: 2.6, PILLOWCOVER: 0.5, JACKET: 2,
  };

  const rates = createdServices
    .filter((service) => service.pricingMode !== "PER_KG")
    .flatMap((service) =>
      createdTypes.map((type) => ({
        serviceId: service.id,
        garmentTypeId: type.id,
        price: round2(Number(service.basePrice) * (multipliers[type.code] ?? 1)),
      })),
    );

  await prisma.serviceRate.createMany({ data: rates, skipDuplicates: true });

  console.log(
    `  ${createdServices.length} services, ${createdTypes.length} garment types, ${rates.length} rates`,
  );
  return { services: createdServices, garmentTypes: createdTypes };
}

async function seedInventory(branchIds: string[]) {
  const items = [
    { sku: "DET-001", name: "Industrial Detergent Powder", category: "DETERGENT" as const, unit: "kg", minStockLevel: 50, costPrice: 120 },
    { sku: "DET-002", name: "Liquid Detergent Concentrate", category: "DETERGENT" as const, unit: "L", minStockLevel: 40, costPrice: 210 },
    { sku: "BLC-001", name: "Oxygen Bleach", category: "BLEACH" as const, unit: "L", minStockLevel: 20, costPrice: 180 },
    { sku: "SOF-001", name: "Fabric Softener — Lavender", category: "FABRIC_SOFTENER" as const, unit: "L", minStockLevel: 30, costPrice: 160 },
    { sku: "STN-001", name: "Enzyme Stain Remover", category: "STAIN_REMOVER" as const, unit: "L", minStockLevel: 15, costPrice: 340 },
    { sku: "CHM-001", name: "Perchloroethylene (Dry Clean)", category: "CHEMICAL" as const, unit: "L", minStockLevel: 25, costPrice: 480 },
    { sku: "PKG-001", name: "Poly Garment Cover — Large", category: "PACKAGING" as const, unit: "pcs", minStockLevel: 500, costPrice: 4 },
    { sku: "PKG-002", name: "Kraft Paper Bag", category: "PACKAGING" as const, unit: "pcs", minStockLevel: 300, costPrice: 9 },
    { sku: "HNG-001", name: "Wire Hanger", category: "HANGER" as const, unit: "pcs", minStockLevel: 400, costPrice: 6 },
    { sku: "HNG-002", name: "Wooden Suit Hanger", category: "HANGER" as const, unit: "pcs", minStockLevel: 100, costPrice: 48 },
    { sku: "COV-001", name: "Suit Cover", category: "COVER" as const, unit: "pcs", minStockLevel: 120, costPrice: 22 },
    { sku: "TAG-001", name: "Garment Tag Roll", category: "TAG" as const, unit: "roll", minStockLevel: 20, costPrice: 260 },
    { sku: "LBL-001", name: "Barcode Label Sheet", category: "LABEL" as const, unit: "sheet", minStockLevel: 50, costPrice: 35 },
  ];

  const created = await Promise.all(
    items.map((item) =>
      prisma.inventoryItem.upsert({
        where: { firmId_sku: { firmId: FIRM_ID, sku: item.sku } },
        create: { ...item, firmId: FIRM_ID },
        update: {},
      }),
    ),
  );

  const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });

  for (const branchId of branchIds) {
    for (const item of created) {
      // A couple of items are deliberately left below their minimum so the
      // low-stock alerting has something real to show.
      const belowMinimum = ["STN-001", "HNG-002"].includes(item.sku);
      const quantity = belowMinimum
        ? round2(Number(item.minStockLevel) * 0.4)
        : round2(Number(item.minStockLevel) * (1.5 + random() * 2));

      await prisma.inventoryStock.upsert({
        where: { itemId_branchId: { itemId: item.id, branchId } },
        create: { itemId: item.id, branchId, quantity },
        update: { quantity },
      });

      await prisma.inventoryTransaction.create({
        data: {
          itemId: item.id,
          branchId,
          type: "STOCK_IN",
          quantity,
          balanceAfter: quantity,
          unitCost: Number(item.costPrice),
          reference: "Opening stock",
          userId: admin?.id,
          createdAt: daysAgo(45),
        },
      });
    }
  }

  console.log(`  ${created.length} inventory items stocked at ${branchIds.length} branches`);
  return created;
}

async function seedSuppliers(
  branchId: string,
  items: { id: string; sku: string; costPrice: unknown }[],
  createdById: string,
) {
  const suppliers = await Promise.all(
    [
      {
        code: "SUP-001",
        name: "Karnataka Chemicals & Detergents",
        contactPerson: "Mohan Rao",
        phone: "9845012345",
        email: "sales@kcd.example",
        gstNumber: "29AAACK1234B1Z9",
        paymentTerms: "Net 30",
        creditDays: 30,
      },
      {
        code: "SUP-002",
        name: "Bengaluru Packaging Supplies",
        contactPerson: "Vidya Hegde",
        phone: "9845067890",
        email: "orders@bps.example",
        gstNumber: "29AAACB5678C1Z2",
        paymentTerms: "Net 15",
        creditDays: 15,
      },
    ].map((supplier) =>
      prisma.supplier.upsert({
        where: { firmId_code: { firmId: FIRM_ID, code: supplier.code } },
        create: { ...supplier, firmId: FIRM_ID },
        update: {},
      }),
    ),
  );

  const poItems = items.slice(0, 4).map((item) => {
    const quantity = randomInt(40, 160);
    const unitPrice = Number(item.costPrice);
    const base = round2(quantity * unitPrice);
    return {
      itemId: item.id,
      quantity,
      unitPrice,
      taxRate: 18,
      lineTotal: round2(base * 1.18),
      base,
    };
  });

  const subtotal = round2(poItems.reduce((sum, item) => sum + item.base, 0));
  const taxAmount = round2(subtotal * 0.18);

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO00001",
      supplierId: suppliers[0].id,
      branchId,
      firmId: FIRM_ID,
      status: "RECEIVED",
      orderDate: daysAgo(20),
      expectedDate: daysAgo(14),
      subtotal,
      taxAmount,
      total: round2(subtotal + taxAmount),
      createdById,
      items: {
        create: poItems.map(({ base: _base, ...item }) => ({
          ...item,
          receivedQuantity: item.quantity,
        })),
      },
    },
  });

  await prisma.goodsReceipt.create({
    data: {
      grnNumber: "GRN00001",
      poId: po.id,
      branchId,
      receivedAt: daysAgo(14),
      receivedById: createdById,
      items: {
        create: poItems.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
  });

  const invoice = await prisma.purchaseInvoice.create({
    data: {
      invoiceNumber: po.poNumber,
      supplierId: suppliers[0].id,
      poId: po.id,
      invoiceDate: daysAgo(14),
      dueDate: daysAgo(-16),
      subtotal,
      taxAmount,
      total: round2(subtotal + taxAmount),
      amountPaid: round2((subtotal + taxAmount) * 0.5),
      status: "PARTIALLY_PAID",
    },
  });

  await prisma.supplierPayment.create({
    data: {
      paymentNumber: "SPY00001",
      supplierId: suppliers[0].id,
      invoiceId: invoice.id,
      amount: round2((subtotal + taxAmount) * 0.5),
      method: "BANK_TRANSFER",
      reference: "NEFT/2026/0041",
      paidAt: daysAgo(7),
      paidById: createdById,
    },
  });

  // A second, still-open order so the purchases screen shows work in flight.
  const openItems = items.slice(4, 7).map((item) => {
    const quantity = randomInt(50, 200);
    const unitPrice = Number(item.costPrice);
    return {
      itemId: item.id,
      quantity,
      unitPrice,
      taxRate: 18,
      lineTotal: round2(quantity * unitPrice * 1.18),
    };
  });
  const openSubtotal = round2(
    openItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
  );

  await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO00002",
      supplierId: suppliers[1].id,
      branchId,
      firmId: FIRM_ID,
      status: "SENT",
      orderDate: daysAgo(3),
      expectedDate: daysAgo(-4),
      subtotal: openSubtotal,
      taxAmount: round2(openSubtotal * 0.18),
      total: round2(openSubtotal * 1.18),
      createdById,
      items: { create: openItems },
    },
  });

  await prisma.sequence.upsert({
    where: { key: "purchase_order" },
    create: { key: "purchase_order", value: 2 },
    update: { value: 2 },
  });
  await prisma.sequence.upsert({
    where: { key: "goods_receipt" },
    create: { key: "goods_receipt", value: 1 },
    update: { value: 1 },
  });
  await prisma.sequence.upsert({
    where: { key: "supplier_payment" },
    create: { key: "supplier_payment", value: 1 },
    update: { value: 1 },
  });

  console.log(`  ${suppliers.length} suppliers, 2 purchase orders`);
  return suppliers;
}

async function seedB2B(
  branchId: string,
  services: { id: string; code: string }[],
  garmentTypes: { id: string; code: string }[],
) {
  const accounts = [
    {
      code: "HTL-001",
      businessName: "The Grand Orchid Hotel",
      type: "HOTEL" as const,
      contactPerson: "Ashok Menon",
      phone: "9880011223",
      email: "housekeeping@grandorchid.example",
      billingAddress: "12 Residency Road, Bengaluru 560025",
      gstNumber: "29AAACG7788D1Z4",
      creditLimit: 200000,
      creditDays: 30,
      paymentTerms: "Monthly billing, net 30",
    },
    {
      code: "HSP-001",
      businessName: "Sunrise Multispeciality Hospital",
      type: "HOSPITAL" as const,
      contactPerson: "Dr. Latha Krishnan",
      phone: "9880033445",
      email: "admin@sunrisehospital.example",
      billingAddress: "Sarjapur Road, Bengaluru 560035",
      gstNumber: "29AAACS9911E1Z7",
      creditLimit: 350000,
      creditDays: 45,
      paymentTerms: "Fortnightly billing, net 45",
    },
    {
      code: "GYM-001",
      businessName: "IronCore Fitness",
      type: "GYM" as const,
      contactPerson: "Nikhil Bose",
      phone: "9880055667",
      email: "ops@ironcore.example",
      billingAddress: "HSR Layout Sector 2, Bengaluru 560102",
      creditLimit: 60000,
      creditDays: 15,
      paymentTerms: "Weekly billing",
    },
  ];

  const created = await Promise.all(
    accounts.map((account) =>
      prisma.b2BAccount.upsert({
        where: { code: account.code },
        create: { ...account, branchId, firmId: FIRM_ID },
        update: {},
      }),
    ),
  );

  const washFold = services.find((service) => service.code === "WASH-FOLD");
  const washIron = services.find((service) => service.code === "WASH-IRON");
  const bedsheet = garmentTypes.find((type) => type.code === "BEDSHEET");
  const towel = garmentTypes.find((type) => type.code === "TOWEL");

  for (const [index, account] of created.entries()) {
    const contract = await prisma.b2BContract.create({
      data: {
        contractNumber: `CNT${String(index + 1).padStart(5, "0")}`,
        accountId: account.id,
        status: "ACTIVE",
        billingCycle: index === 1 ? "FORTNIGHTLY" : index === 2 ? "WEEKLY" : "MONTHLY",
        startDate: daysAgo(180),
        minimumMonthlyValue: [50000, 90000, 15000][index],
        terms:
          "Daily pickup at 08:00, 24-hour turnaround on linen. Damages reported within 24 hours of delivery.",
      },
    });

    const rateCards = [
      washFold && {
        contractId: contract.id,
        serviceId: washFold.id,
        garmentTypeId: null,
        pricingMode: "PER_KG" as const,
        rate: [62, 55, 70][index],
        effectiveFrom: daysAgo(180),
      },
      washIron &&
        bedsheet && {
          contractId: contract.id,
          serviceId: washIron.id,
          garmentTypeId: bedsheet.id,
          pricingMode: "PER_PIECE" as const,
          rate: [42, 38, 48][index],
          effectiveFrom: daysAgo(180),
        },
      washIron &&
        towel && {
          contractId: contract.id,
          serviceId: washIron.id,
          garmentTypeId: towel.id,
          pricingMode: "PER_PIECE" as const,
          rate: [16, 14, 18][index],
          effectiveFrom: daysAgo(180),
        },
    ].filter(Boolean) as {
      contractId: string;
      serviceId: string;
      garmentTypeId: string | null;
      pricingMode: "PER_KG" | "PER_PIECE";
      rate: number;
      effectiveFrom: Date;
    }[];

    await prisma.b2BRateCard.createMany({ data: rateCards, skipDuplicates: true });

    await prisma.b2BSchedule.createMany({
      data: [
        {
          accountId: account.id,
          type: "PICKUP",
          dayOfWeek: 1,
          timeSlot: "08:00 – 09:00",
        },
        {
          accountId: account.id,
          type: "DELIVERY",
          dayOfWeek: 3,
          timeSlot: "17:00 – 19:00",
        },
      ],
    });
  }

  await prisma.sequence.upsert({
    where: { key: "contract" },
    create: { key: "contract", value: created.length },
    update: { value: created.length },
  });

  console.log(`  ${created.length} corporate accounts with contracts and rate cards`);
  return created;
}

async function seedNotificationTemplates() {
  const templates = [
    { event: "ORDER_RECEIVED", name: "Order received", channel: "IN_APP" },
    { event: "ORDER_READY", name: "Order ready", channel: "IN_APP" },
    { event: "OUT_FOR_DELIVERY", name: "Out for delivery", channel: "IN_APP" },
    { event: "DELIVERED", name: "Delivered", channel: "IN_APP" },
    { event: "PAYMENT_RECEIVED", name: "Payment received", channel: "IN_APP" },
    { event: "PAYMENT_REMINDER", name: "Payment reminder", channel: "IN_APP" },
    { event: "ORDER_DELAYED", name: "Order delayed", channel: "IN_APP" },
    { event: "PICKUP_SCHEDULED", name: "Pickup scheduled", channel: "IN_APP" },
    { event: "COMPLAINT_REGISTERED", name: "Complaint registered", channel: "EMAIL" },
    { event: "COMPLAINT_RESOLVED", name: "Complaint resolved", channel: "EMAIL" },
  ] as const;

  await Promise.all(
    templates.map((template) =>
      prisma.notificationTemplate.upsert({
        where: { code: `${template.event.toLowerCase()}_${template.channel.toLowerCase()}` },
        create: {
          code: `${template.event.toLowerCase()}_${template.channel.toLowerCase()}`,
          name: template.name,
          channel: template.channel,
          event: template.event,
          subject:
            template.channel === "EMAIL" ? `${template.name} — {{orderNumber}}` : null,
          body: DEFAULT_NOTIFICATION_BODIES[template.event],
        },
        update: {},
      }),
    ),
  );

  // Templates are configuration rather than transactional data, so they are not
  // cleared with everything else — retire any that are no longer in the list.
  await prisma.notificationTemplate.deleteMany({
    where: {
      code: {
        notIn: templates.map(
          (template) => `${template.event.toLowerCase()}_${template.channel.toLowerCase()}`,
        ),
      },
    },
  });

  console.log(`  ${templates.length} notification templates`);
}

interface SeededGarment {
  id: string;
  code: string;
  orderId: string;
  branchId: string;
  trackingCategory: TrackingCategory;
  stage: ProcessingStage;
  status: GarmentStatus;
  scannedAt: Date;
}

/**
 * Plants the four problems the mismatch centre is built to catch, on real
 * garments, so the screen has something true to show on a fresh install:
 * a piece scanned against someone else's order, the same piece scanned twice
 * at one station, a piece read into the wrong category's bucket, and a piece
 * reported missing outright.
 */
async function seedGarmentAnomalies(
  garments: SeededGarment[],
  counterUserId: string,
): Promise<number> {
  const inProgress = garments.filter(
    (garment) => garment.status !== "DELIVERED" && garment.status !== "LOST",
  );
  if (inProgress.length < 12) return 0;

  const taken = new Set<string>();
  const take = (count: number) => {
    const chosen: SeededGarment[] = [];
    while (chosen.length < count) {
      const candidate = pick(inProgress);
      if (taken.has(candidate.id)) continue;
      taken.add(candidate.id);
      chosen.push(candidate);
    }
    return chosen;
  };

  let planted = 0;

  // 1. Scanned against the wrong order — the classic counter slip.
  for (const garment of take(4)) {
    const other = inProgress.find(
      (candidate) => candidate.orderId !== garment.orderId && !taken.has(candidate.id),
    );
    if (!other) continue;
    await prisma.garmentScan.create({
      data: {
        garmentId: garment.id,
        orderId: garment.orderId,
        contextOrderId: other.orderId,
        branchId: garment.branchId,
        trackingCategory: garment.trackingCategory,
        stage: garment.stage,
        outcome: "WRONG_ORDER",
        note: `Scanned while working another order`,
        scannedById: counterUserId,
        scannedAt: hoursFrom(garment.scannedAt, 0.2),
      },
    });
    planted += 1;
  }

  // 2. The same piece read twice at one station.
  for (const garment of take(3)) {
    await prisma.garmentScan.create({
      data: {
        garmentId: garment.id,
        orderId: garment.orderId,
        contextOrderId: garment.orderId,
        branchId: garment.branchId,
        trackingCategory: garment.trackingCategory,
        stage: garment.stage,
        outcome: "DUPLICATE",
        note: "Second read at the same station",
        scannedById: counterUserId,
        scannedAt: hoursFrom(garment.scannedAt, 0.05),
      },
    });
    planted += 1;
  }

  // 3. Read from the wrong category bucket at a station.
  for (const garment of take(2)) {
    await prisma.garmentScan.create({
      data: {
        garmentId: garment.id,
        orderId: garment.orderId,
        contextOrderId: garment.orderId,
        branchId: garment.branchId,
        trackingCategory: garment.trackingCategory,
        stage: garment.stage,
        outcome: "WRONG_CATEGORY",
        note: "Scanned into the wrong category's bucket",
        scannedById: counterUserId,
        scannedAt: hoursFrom(garment.scannedAt, 0.3),
      },
    });
    planted += 1;
  }

  // 4. Reported missing at the station.
  for (const garment of take(2)) {
    await prisma.garment.update({
      where: { id: garment.id },
      data: { status: "LOST" },
    });
    await prisma.garmentException.create({
      data: {
        garmentId: garment.id,
        branchId: garment.branchId,
        type: "MISSING",
        detail: `Not in the bundle at ${garment.stage.toLowerCase()}`,
        reportedById: counterUserId,
        reportedAt: hoursFrom(garment.scannedAt, 2),
      },
    });
    planted += 1;
  }

  return planted;
}

/** A customer as the order seeder needs it: enough to fill an order's snapshot. */
interface DirectoryEntry {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
}

interface OrderPlan {
  /** How far the order should have progressed, as a fraction of the pipeline. */
  progress: "fresh" | "mid" | "ready" | "delivered" | "delayed";
}

async function seedOrders(context: {
  branches: { id: string; code: string }[];
  services: { id: string; code: string; pricingMode: string; basePrice: unknown; stages: string[]; turnaroundHours: number }[];
  garmentTypes: { id: string; code: string; name: string }[];
  users: SeededUser[];
  b2bAccounts: { id: string; code: string; businessName: string; phone: string }[];
}) {
  const { branches, services, garmentTypes, users, b2bAccounts } = context;

  const counter = users.find((user) => user.employeeCode === "EMP0005")!;
  const washer = users.find((user) => user.employeeCode === "EMP0007")!;
  const ironer = users.find((user) => user.employeeCode === "EMP0008")!;
  const qc = users.find((user) => user.employeeCode === "EMP0009")!;
  const packer = users.find((user) => user.employeeCode === "EMP0010")!;
  const drivers = await prisma.driver.findMany({ include: { user: true } });

  const rates = await prisma.serviceRate.findMany();
  const rateKey = (serviceId: string, garmentTypeId: string) =>
    `${serviceId}:${garmentTypeId}`;
  const rateMap = new Map(
    rates.map((rate) => [rateKey(rate.serviceId, rate.garmentTypeId), Number(rate.price)]),
  );

  const STAGE_ORDER: ProcessingStage[] = [
    "SORTING", "WASHING", "DRYING", "IRONING", "QUALITY_CHECK", "PACKING",
  ];

  const operatorFor: Record<string, SeededUser> = {
    SORTING: counter,
    WASHING: washer,
    DRYING: washer,
    IRONING: ironer,
    QUALITY_CHECK: qc,
    PACKING: packer,
  };

  const doneStatus: Record<string, GarmentStatus> = {
    SORTING: "SORTED",
    WASHING: "WASHED",
    DRYING: "DRIED",
    IRONING: "IRONED",
    QUALITY_CHECK: "QC_PASSED",
    PACKING: "PACKED",
  };

  const plans: OrderPlan[] = [
    ...Array.from({ length: 8 }, () => ({ progress: "fresh" as const })),
    ...Array.from({ length: 12 }, () => ({ progress: "mid" as const })),
    ...Array.from({ length: 10 }, () => ({ progress: "ready" as const })),
    ...Array.from({ length: 14 }, () => ({ progress: "delivered" as const })),
    ...Array.from({ length: 4 }, () => ({ progress: "delayed" as const })),
  ];

  let orderCounter = 0;
  let garmentCounter = 0;
  const categoryCounters = new Map<string, number>();

  // Every completed stage leaves a scan behind, which is what the mismatch
  // centre reads. A small share are deliberately dropped: garments that moved
  // without anyone scanning them are exactly the problem the feature exists to
  // surface, and a demo with none of them proves nothing.
  const scans: {
    garmentId: string;
    orderId: string;
    contextOrderId: string | null;
    branchId: string;
    trackingCategory: TrackingCategory;
    stage: ProcessingStage;
    outcome: "MATCH" | "WRONG_ORDER" | "WRONG_CATEGORY" | "DUPLICATE";
    location: string | null;
    scannedById: string;
    scannedAt: Date;
  }[] = [];
  const seededGarments: {
    id: string;
    code: string;
    orderId: string;
    branchId: string;
    trackingCategory: TrackingCategory;
    stage: ProcessingStage;
    status: GarmentStatus;
    scannedAt: Date;
  }[] = [];
  let invoiceCounter = 0;
  let paymentCounter = 0;
  let deliveryCounter = 0;
  let pickupCounter = 0;
  const createdOrders: { id: string; orderNumber: string; branchId: string }[] = [];

  // A directory per branch, sized so roughly half the orders land on a repeat
  // customer — which is what makes the repeat badge and lifetime totals mean
  // something on the customer screens.
  let customerCounter = 0;
  const directory = new Map<string, DirectoryEntry[]>();

  for (const branch of branches.filter((entry) => entry.code !== "HO")) {
    const entries: DirectoryEntry[] = [];
    for (let index = 0; index < 14; index += 1) {
      customerCounter += 1;
      const name = fullName();
      const area = pick(AREAS);
      const record = await prisma.customer.create({
        data: {
          code: `CUS${10000 + customerCounter}`,
          branchId: branch.id,
          firmId: FIRM_ID,
          name,
          phone: phone().replace(/\D/g, "").slice(-10),
          email:
            random() < 0.55
              ? `${name.split(" ")[0].toLowerCase()}${randomInt(10, 99)}@example.com`
              : null,
          addressLine: `${randomInt(1, 400)}, ${randomInt(1, 12)}th Cross, ${area}`,
          city: "Bengaluru",
          pincode: `5600${randomInt(10, 99)}`,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          addressLine: true,
          city: true,
          pincode: true,
        },
      });
      entries.push(record);
    }
    directory.set(branch.id, entries);
  }

  const b2bCustomers = new Map<string, DirectoryEntry>();

  for (const plan of plans) {
    orderCounter += 1;

    const branch = pick(branches.filter((entry) => entry.code !== "HO"));
    const isB2B = random() < 0.18 && b2bAccounts.length > 0;
    const account = isB2B ? pick(b2bAccounts) : null;

    const ageDays =
      plan.progress === "delivered"
        ? randomInt(3, 28)
        : plan.progress === "delayed"
          ? randomInt(5, 12)
          : plan.progress === "ready"
            ? randomInt(1, 3)
            : randomInt(0, 2);

    const placedAt = daysAgo(ageDays, randomInt(9, 18));
    const orderType = pick(["WALK_IN", "WALK_IN", "PICKUP", "DELIVERY"] as const);

    // Build line items.
    const lineCount = randomInt(1, 3);
    const lines = Array.from({ length: lineCount }, () => {
      const service = pick(services);
      const garmentType = pick(garmentTypes);
      const quantity = service.pricingMode === "PER_KG" ? randomInt(4, 12) : randomInt(1, 6);
      const weightKg =
        service.pricingMode === "PER_KG" ? round2(quantity * (0.35 + random() * 0.4)) : 0;
      const unitPrice =
        service.pricingMode === "PER_KG"
          ? Number(service.basePrice)
          : (rateMap.get(rateKey(service.id, garmentType.id)) ?? Number(service.basePrice));
      const billable = service.pricingMode === "PER_KG" ? weightKg : quantity;

      return {
        service,
        garmentType,
        quantity,
        weightKg,
        unitPrice,
        lineTotal: round2(unitPrice * billable),
      };
    });

    const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const discountAmount = random() < 0.2 ? round2(subtotal * 0.1) : 0;
    const taxableAmount = round2(subtotal - discountAmount);
    const gstAmount = round2(taxableAmount * 0.18);
    const totalAmount = round2(taxableAmount + gstAmount);
    const totalPieces = lines.reduce((sum, line) => sum + line.quantity, 0);
    const totalWeightKg = round2(lines.reduce((sum, line) => sum + line.weightKg, 0));

    const turnaround = Math.max(...lines.map((line) => line.service.turnaroundHours));
    const expectedDeliveryAt =
      plan.progress === "delayed"
        ? hoursFrom(placedAt, 24)
        : hoursFrom(placedAt, turnaround);

    const paid =
      plan.progress === "delivered"
        ? totalAmount
        : random() < 0.45
          ? round2(totalAmount * (random() < 0.5 ? 0.3 : 0.5))
          : 0;
    const outstanding = round2(totalAmount - paid);

    let customer: DirectoryEntry;
    if (account) {
      const cached = b2bCustomers.get(`${branch.id}:${account.id}`);
      customer =
        cached ??
        (await prisma.customer.create({
          data: {
            code: `CUS${10000 + (customerCounter += 1)}`,
            branchId: branch.id,
            firmId: FIRM_ID,
            name: account.businessName,
            phone: account.phone.replace(/\D/g, "").slice(-10),
            addressLine: `${randomInt(1, 400)}, ${randomInt(1, 12)}th Cross, ${pick(AREAS)}`,
            city: "Bengaluru",
            pincode: `5600${randomInt(10, 99)}`,
          },
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            addressLine: true,
            city: true,
            pincode: true,
          },
        }));
      b2bCustomers.set(`${branch.id}:${account.id}`, customer);
    } else {
      customer = pick(directory.get(branch.id) ?? []);
    }

    const customerName = customer.name;
    const customerPhone = customer.phone;

    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD${10000 + orderCounter}`,
        branchId: branch.id,
        firmId: FIRM_ID,
        type: orderType,
        priority: random() < 0.15 ? "EXPRESS" : "NORMAL",
        status: "RECEIVED",
        paymentStatus:
          paid <= 0 ? "UNPAID" : paid >= totalAmount ? "PAID" : "PARTIALLY_PAID",
        customerId: customer.id,
        customerName,
        customerPhone,
        customerEmail: customer.email,
        addressLine: customer.addressLine,
        city: customer.city,
        pincode: customer.pincode,
        b2bAccountId: account?.id ?? null,
        placedAt,
        expectedDeliveryAt,
        subtotal,
        discountAmount,
        discountReason: discountAmount > 0 ? "Loyalty discount" : null,
        taxableAmount,
        gstRate: 18,
        gstAmount,
        totalAmount,
        paidAmount: paid,
        outstandingAmount: outstanding,
        totalPieces,
        totalWeightKg,
        specialInstructions: random() < 0.3 ? "No starch, hang dry only" : null,
        stainNotes: random() < 0.25 ? "Coffee mark on the front panel" : null,
        createdById: counter.id,
        createdAt: placedAt,
        items: {
          create: lines.map((line) => ({
            serviceId: line.service.id,
            garmentTypeId: line.garmentType.id,
            quantity: line.quantity,
            weightKg: line.weightKg,
            pricingMode: line.service.pricingMode as never,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
        },
        statusHistory: {
          create: {
            toStatus: "RECEIVED",
            userId: counter.id,
            userName: counter.name,
            note: "Order booked at counter",
            createdAt: placedAt,
          },
        },
      },
      include: { items: true },
    });

    createdOrders.push({
      id: order.id,
      orderNumber: order.orderNumber,
      branchId: branch.id,
    });

    // Invoice
    invoiceCounter += 1;
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV${String(invoiceCounter).padStart(6, "0")}`,
        type: "ORDER",
        status: paid >= totalAmount ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED",
        branchId: branch.id,
        firmId: FIRM_ID,
        orderId: order.id,
        b2bAccountId: account?.id ?? null,
        billToName: customerName,
        billToPhone: customerPhone,
        subtotal,
        discountAmount,
        taxableAmount,
        gstRate: 18,
        cgstAmount: round2(gstAmount / 2),
        sgstAmount: round2(gstAmount - round2(gstAmount / 2)),
        totalAmount,
        amountPaid: paid,
        amountDue: outstanding,
        issuedAt: placedAt,
        dueAt: expectedDeliveryAt,
        issuedById: counter.id,
        lines: {
          create: order.items.map((item, index) => ({
            orderId: order.id,
            description: `${lines[index].service.code} — ${lines[index].garmentType.name}`,
            quantity:
              lines[index].service.pricingMode === "PER_KG"
                ? lines[index].weightKg
                : item.quantity,
            unitPrice: lines[index].unitPrice,
            lineTotal: lines[index].lineTotal,
          })),
        },
      },
    });

    if (paid > 0) {
      paymentCounter += 1;
      await prisma.payment.create({
        data: {
          paymentNumber: `PAY${String(paymentCounter).padStart(6, "0")}`,
          branchId: branch.id,
          firmId: FIRM_ID,
          orderId: order.id,
          amount: paid,
          method: pick(["CASH", "UPI", "CARD", "ONLINE"] as const),
          provider: "MANUAL",
          state: "CAPTURED",
          isAdvance: paid < totalAmount,
          paidAt:
            plan.progress === "delivered"
              ? progressedTo(placedAt, turnaround)
              : placedAt,
          receivedById: counter.id,
        },
      });
    }

    if (orderType === "PICKUP") {
      pickupCounter += 1;
      await prisma.pickup.create({
        data: {
          pickupNumber: `PCK${String(pickupCounter).padStart(6, "0")}`,
          orderId: order.id,
          branchId: branch.id,
          status: plan.progress === "fresh" ? "DRIVER_ASSIGNED" : "RECEIVED_AT_LAUNDRY",
          driverId: drivers.length ? pick(drivers).id : null,
          scheduledAt: placedAt,
          receivedAt: plan.progress === "fresh" ? null : progressedTo(placedAt, 2),
          contactName: customerName,
          contactPhone: customerPhone,
          addressLine: order.addressLine ?? "",
        },
      });
    }

    // -----------------------------------------------------------------------
    // Garments, tasks and their history.
    // -----------------------------------------------------------------------
    const pipelineFor = (stages: string[]) =>
      STAGE_ORDER.filter((stage) => stages.includes(stage) || stage === "PACKING");

    const targetIndexFor = (pipeline: ProcessingStage[]) => {
      switch (plan.progress) {
        case "fresh":
          return randomInt(0, 1);
        case "mid":
        case "delayed":
          return randomInt(1, Math.max(1, pipeline.length - 2));
        case "ready":
        case "delivered":
          return pipeline.length;
      }
    };

    let laggardStage: ProcessingStage = "DISPATCH";
    let laggardRank = STAGE_ORDER.length;
    let laggardStatus: GarmentStatus = "RECEIVED";

    for (const [lineIndex, item] of order.items.entries()) {
      const line = lines[lineIndex];
      const pipeline = pipelineFor(line.service.stages);
      const target = targetIndexFor(pipeline);

      // Garments in one order move together, give or take a station. The floor
      // keeps a single straggler from dragging the whole order's status back to
      // sorting, which is what makes an in-progress order look believable.
      const floor =
        plan.progress === "fresh"
          ? 0
          : Math.max(1, Math.min(target, target - 1));

      const trackingCategory = categoryForTypeCode(line.garmentType.code);
      const prefix = categoryPrefix(trackingCategory);

      for (let piece = 0; piece < item.quantity; piece += 1) {
        garmentCounter += 1;
        const categorySeq = (categoryCounters.get(prefix) ?? 0) + 1;
        categoryCounters.set(prefix, categorySeq);
        const code = `${prefix}-${1000 + categorySeq}`;

        const completed = Math.min(pipeline.length, randomInt(floor, target));

        const history: {
          toStatus: GarmentStatus;
          fromStatus: GarmentStatus | null;
          stage: ProcessingStage;
          userId: string;
          userName: string;
          createdAt: Date;
          note: string | null;
        }[] = [
          {
            toStatus: "RECEIVED",
            fromStatus: null,
            stage: "RECEIVING",
            userId: counter.id,
            userName: counter.name,
            createdAt: placedAt,
            note: "Garment received at counter",
          },
        ];

        let currentStatus: GarmentStatus = "RECEIVED";
        let currentStage: ProcessingStage = "RECEIVING";
        let cursor = placedAt;

        const tasks = pipeline.map((stage, index) => {
          const operator = operatorFor[stage];
          const isDone = index < completed;
          const isActive = index === completed && plan.progress !== "delivered";

          if (isDone) {
            cursor = progressedTo(cursor, 1 + random() * 5);
            const finished = doneStatus[stage];
            history.push({
              fromStatus: currentStatus,
              toStatus: finished,
              stage,
              userId: operator.id,
              userName: operator.name,
              createdAt: cursor,
              note: null,
            });
            currentStatus = finished;
            currentStage = stage;
          } else if (isActive) {
            currentStage = stage;
          }

          return {
            stage,
            sequence: index,
            status: isDone
              ? stage === "QUALITY_CHECK"
                ? ("PASSED" as const)
                : ("COMPLETED" as const)
              : isActive
                ? ("PENDING" as const)
                : ("PENDING" as const),
            branchId: branch.id,
            assignedToId: isDone ? operator.id : null,
            startedAt: isDone ? cursor : null,
            completedAt: isDone ? cursor : null,
            durationSeconds: isDone ? randomInt(240, 3600) : null,
          };
        });

        if (plan.progress === "ready") {
          cursor = progressedTo(cursor, 0.5);
          history.push({
            fromStatus: currentStatus,
            toStatus: "READY",
            stage: "PACKING",
            userId: packer.id,
            userName: packer.name,
            createdAt: cursor,
            note: "Packed and ready for pickup",
          });
          currentStatus = "READY";
          currentStage = "PACKING";
        }

        if (plan.progress === "delivered") {
          cursor = progressedTo(cursor, 2);
          history.push({
            fromStatus: currentStatus,
            toStatus: "DELIVERED",
            stage: "DISPATCH",
            userId: drivers.length ? drivers[0].userId : counter.id,
            userName: drivers.length ? drivers[0].user.name : counter.name,
            createdAt: cursor,
            note: "Handed to customer",
          });
          currentStatus = "DELIVERED";
          currentStage = "DISPATCH";
        }

        const garment = await prisma.garment.create({
          data: {
            garmentCode: code,
            qrPayload: `AURA:G:${code}`,
            barcodeValue: code,
            firmId: FIRM_ID,
            orderId: order.id,
            orderItemId: item.id,
            garmentTypeId: item.garmentTypeId,
            trackingCategory,
            serviceId: item.serviceId,
            branchId: branch.id,
            status: currentStatus,
            currentStage,
            color: pick(["White", "Blue", "Black", "Beige", "Maroon", "Grey"]),
            lastScannedAt: cursor,
            lastScannedById: operatorFor[currentStage] ? operatorFor[currentStage].id : counter.id,
            deliveredAt: plan.progress === "delivered" ? cursor : null,
            createdAt: placedAt,
            statusHistory: {
              create: history.map((entry) => ({
                fromStatus: entry.fromStatus,
                toStatus: entry.toStatus,
                stage: entry.stage,
                branchId: branch.id,
                userId: entry.userId,
                userName: entry.userName,
                note: entry.note,
                createdAt: entry.createdAt,
              })),
            },
            tasks: { create: tasks },
          },
          select: { id: true },
        });

        for (const entry of history) {
          // ~5% of movements happen without a scan.
          if (random() < 0.05) continue;
          scans.push({
            garmentId: garment.id,
            orderId: order.id,
            contextOrderId: order.id,
            branchId: branch.id,
            trackingCategory,
            stage: entry.stage,
            outcome: "MATCH",
            location: null,
            scannedById: entry.userId,
            scannedAt: entry.createdAt,
          });
        }

        seededGarments.push({
          id: garment.id,
          code,
          orderId: order.id,
          branchId: branch.id,
          trackingCategory,
          stage: currentStage,
          status: currentStatus,
          scannedAt: cursor,
        });

        // Track the station the slowest garment is queued at, exactly as
        // recomputeOrderStatus does at runtime.
        const waitingAt: ProcessingStage =
          completed < pipeline.length ? pipeline[completed] : "DISPATCH";
        const rank = STAGE_ORDER.indexOf(waitingAt);
        if (rank < laggardRank) {
          laggardRank = rank;
          laggardStage = waitingAt;
          laggardStatus = currentStatus;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Order header status, derived from where its garments actually are.
    // -----------------------------------------------------------------------
    const STATUS_FOR_STAGE: Record<string, OrderStatus> = {
      RECEIVING: "RECEIVED",
      SORTING: "SORTING",
      WASHING: "WASHING",
      DRYING: "DRYING",
      IRONING: "IRONING",
      QUALITY_CHECK: "QUALITY_CHECK",
      PACKING: "PACKING",
      DISPATCH: "OUT_FOR_DELIVERY",
    };

    const orderStatus: OrderStatus =
      plan.progress === "delivered"
        ? "DELIVERED"
        : plan.progress === "ready"
          ? "READY"
          : laggardStatus === "RECEIVED" && laggardStage === "SORTING"
            ? "RECEIVED"
            : (STATUS_FOR_STAGE[laggardStage as string] ?? "SORTING");

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: orderStatus,
        readyAt:
          plan.progress === "ready" || plan.progress === "delivered"
            ? progressedTo(placedAt, turnaround - 4)
            : null,
        deliveredAt:
          plan.progress === "delivered" ? progressedTo(placedAt, turnaround) : null,
      },
    });

    if (orderStatus !== "RECEIVED") {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "RECEIVED",
          toStatus: orderStatus,
          userId: counter.id,
          userName: counter.name,
          note: "Derived from garment progress",
          createdAt: progressedTo(placedAt, 3),
        },
      });
    }

    // Deliveries for anything ready or already handed over.
    if (
      (plan.progress === "ready" || plan.progress === "delivered") &&
      drivers.length > 0
    ) {
      deliveryCounter += 1;
      const driver = pick(drivers);
      await prisma.delivery.create({
        data: {
          deliveryNumber: `DLV${String(deliveryCounter).padStart(6, "0")}`,
          orderId: order.id,
          branchId: branch.id,
          firmId: FIRM_ID,
          status: plan.progress === "delivered" ? "DELIVERED" : "DRIVER_ASSIGNED",
          driverId: driver.id,
          scheduledAt: hoursFrom(placedAt, turnaround),
          assignedAt: progressedTo(placedAt, turnaround - 2),
          dispatchedAt:
            plan.progress === "delivered"
              ? progressedTo(placedAt, turnaround - 1)
              : null,
          deliveredAt:
            plan.progress === "delivered" ? progressedTo(placedAt, turnaround) : null,
          contactName: customerName,
          contactPhone: customerPhone,
          addressLine: order.addressLine ?? "",
          amountToCollect: outstanding,
          amountCollected: plan.progress === "delivered" ? outstanding : 0,
          collectionMethod: plan.progress === "delivered" ? "CASH" : null,
          garmentCount: totalPieces,
          attemptCount: plan.progress === "delivered" ? 1 : 0,
          receivedByName: plan.progress === "delivered" ? customerName : null,
        },
      });
    }
  }

  await prisma.garmentScan.createMany({ data: scans });

  // A handful of real problems for the mismatch centre to find. Without these
  // the screen looks like it works and proves nothing.
  const anomalies = await seedGarmentAnomalies(seededGarments, counter.id);

  // Roll the lifetime figures up the same way the application does, in one
  // pass rather than per order.
  await prisma.$executeRaw`
    UPDATE "customers" c
    SET "orderCount" = t."orders",
        "totalSpent" = t."paid",
        "outstandingAmount" = t."due",
        "lastOrderAt" = t."last"
    FROM (
      SELECT o."customerId" AS id,
             count(*) FILTER (WHERE o."status" <> 'CANCELLED') AS "orders",
             coalesce(sum(o."paidAmount") FILTER (WHERE o."status" <> 'CANCELLED'), 0) AS "paid",
             coalesce(sum(o."outstandingAmount") FILTER (WHERE o."status" <> 'CANCELLED'), 0) AS "due",
             max(o."placedAt") AS "last"
      FROM "orders" o
      WHERE o."customerId" IS NOT NULL
      GROUP BY o."customerId"
    ) t
    WHERE c."id" = t."id"`;

  // Keep the sequences ahead of everything the seed created.
  const sequences: [string, number][] = [
    ["order", orderCounter],
    ...[...categoryCounters.entries()].map(
      ([prefix, value]) => [`garment:${prefix}`, value] as [string, number],
    ),
    ["invoice", invoiceCounter],
    ["payment", paymentCounter],
    ["delivery", deliveryCounter],
    ["pickup", pickupCounter],
    ["customer", customerCounter],
  ];

  await prisma.$transaction(
    sequences.map(([key, value]) =>
      prisma.sequence.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );

  console.log(
    `  ${orderCounter} orders, ${garmentCounter} tracked garments, ${customerCounter} customers`,
  );
  console.log(
    `  ${scans.length} garment scans · ${anomalies} seeded mismatches for the mismatch centre`,
  );
  return createdOrders;
}

async function seedComplaints(
  orders: { id: string; orderNumber: string; branchId: string }[],
  users: SeededUser[],
) {
  const manager = users.find((user) => user.employeeCode === "EMP0003")!;
  const qc = users.find((user) => user.employeeCode === "EMP0009")!;

  const samples = [
    {
      type: "STAIN_NOT_REMOVED" as const,
      priority: "MEDIUM" as const,
      description:
        "Customer says the oil mark on the shirt cuff is still visible after the wash.",
      status: "RESOLVED" as const,
      resolution: "REWASH" as const,
      resolutionNotes: "Rewashed with enzyme pre-treatment and returned the same evening.",
    },
    {
      type: "DAMAGED_GARMENT" as const,
      priority: "HIGH" as const,
      description: "A button is missing from the blazer front and the lining is torn.",
      status: "UNDER_INVESTIGATION" as const,
    },
    {
      type: "LATE_DELIVERY" as const,
      priority: "LOW" as const,
      description: "Order arrived two days after the promised date.",
      status: "RESOLVED" as const,
      resolution: "APOLOGY" as const,
      resolutionNotes: "Apologised and waived the express charge on the next order.",
    },
    {
      type: "MISSING_GARMENT" as const,
      priority: "CRITICAL" as const,
      description: "One pillow cover from a set of four did not come back.",
      status: "OPEN" as const,
    },
    {
      type: "COLOR_FADING" as const,
      priority: "MEDIUM" as const,
      description: "The maroon kurta has faded noticeably along the seams.",
      status: "AWAITING_CUSTOMER" as const,
    },
  ];

  for (const [index, sample] of samples.entries()) {
    const order = orders[index * 3] ?? orders[index];
    if (!order) continue;

    const garment = await prisma.garment.findFirst({
      where: { orderId: order.id },
      select: { id: true },
    });

    const orderRecord = await prisma.order.findUnique({
      where: { id: order.id },
      select: { customerName: true, customerPhone: true },
    });

    await prisma.complaint.create({
      data: {
        complaintNumber: `CMP${String(index + 1).padStart(5, "0")}`,
        type: sample.type,
        priority: sample.priority,
        status: sample.status,
        branchId: order.branchId,
        firmId: FIRM_ID,
        orderId: order.id,
        garmentId: garment?.id ?? null,
        raisedByName: orderRecord?.customerName ?? fullName(),
        raisedByPhone: orderRecord?.customerPhone ?? phone(),
        description: sample.description,
        assignedToId: index % 2 === 0 ? qc.id : manager.id,
        investigationNotes:
          sample.status === "OPEN"
            ? null
            : "Checked the intake photographs and spoke to the operator on shift.",
        resolution: sample.resolution ?? null,
        resolutionNotes: sample.resolutionNotes ?? null,
        resolvedAt: sample.resolution ? daysAgo(randomInt(1, 5)) : null,
        resolvedById: sample.resolution ? manager.id : null,
        createdById: manager.id,
        createdAt: daysAgo(randomInt(2, 14)),
      },
    });
  }

  await prisma.sequence.upsert({
    where: { key: "complaint" },
    create: { key: "complaint", value: samples.length },
    update: { value: samples.length },
  });

  console.log(`  ${samples.length} complaints`);
}

async function seedExpensesAndAttendance(
  branches: { id: string; code: string }[],
  users: SeededUser[],
) {
  const owner = users.find((user) => user.employeeCode === "EMP0002")!;
  const accountant = users.find((user) => user.employeeCode === "EMP0013")!;

  const categories = [
    ["RENT", 45000, "Monthly branch rent"],
    ["SALARY", 180000, "Staff salaries"],
    ["UTILITIES", 22000, "Electricity and water"],
    ["MAINTENANCE", 8500, "Boiler servicing"],
    ["TRANSPORT", 12000, "Fuel and vehicle upkeep"],
    ["CONSUMABLES", 31000, "Detergent and packaging restock"],
    ["MARKETING", 15000, "Local flyer campaign"],
  ] as const;

  let expenseCounter = 0;
  for (const branch of branches.filter((entry) => entry.code !== "HO")) {
    for (const [category, amount, description] of categories) {
      expenseCounter += 1;
      await prisma.expense.create({
        data: {
          expenseNumber: `EXP${String(expenseCounter).padStart(5, "0")}`,
          branchId: branch.id,
          firmId: FIRM_ID,
          category,
          status: expenseCounter % 5 === 0 ? "PENDING" : "APPROVED",
          amount: round2(amount * (0.85 + random() * 0.3)),
          description,
          paymentMethod: "BANK_TRANSFER",
          expenseDate: daysAgo(randomInt(1, 30)),
          createdById: accountant.id,
          approvedById: expenseCounter % 5 === 0 ? null : owner.id,
          approvedAt: expenseCounter % 5 === 0 ? null : daysAgo(randomInt(1, 20)),
        },
      });
    }
  }

  await prisma.sequence.upsert({
    where: { key: "expense" },
    create: { key: "expense", value: expenseCounter },
    update: { value: expenseCounter },
  });

  // Two weeks of attendance for everyone on a branch.
  const attendance: {
    userId: string;
    branchId: string | null;
    date: Date;
    status: "PRESENT" | "ABSENT" | "WEEKLY_OFF" | "LEAVE";
  }[] = [];

  for (const user of users) {
    for (let day = 0; day < 14; day += 1) {
      const date = daysAgo(day, 0);
      date.setHours(0, 0, 0, 0);
      const isSunday = date.getDay() === 0;
      attendance.push({
        userId: user.id,
        branchId: user.branchId,
        date,
        status: isSunday
          ? "WEEKLY_OFF"
          : random() < 0.06
            ? random() < 0.5
              ? "ABSENT"
              : "LEAVE"
            : "PRESENT",
      });
    }
  }

  await prisma.attendance.createMany({ data: attendance, skipDuplicates: true });

  await prisma.leave.create({
    data: {
      userId: users.find((user) => user.employeeCode === "EMP0008")!.id,
      type: "CASUAL",
      fromDate: daysAgo(-3),
      toDate: daysAgo(-1),
      reason: "Family function out of town",
      status: "PENDING",
    },
  });

  console.log(`  ${expenseCounter} expenses, ${attendance.length} attendance records`);
}

async function main() {
  console.log("Seeding Aura Laundry ERP…\n");

  console.log("Clearing transactional data…");
  await clearTransactionalData();

  console.log("Firm…");
  await seedFirm();

  console.log("Platform admin…");
  await seedPlatformAdmin();

  console.log("Permissions…");
  await seedPermissions();

  console.log("Settings…");
  await seedSettings();

  console.log("Branches…");
  const branches = await seedBranches();
  const branchList = [
    { id: branches.headOffice.id, code: "HO" },
    { id: branches.branch1.id, code: "BR1" },
    { id: branches.branch2.id, code: "BR2" },
    { id: branches.cpu.id, code: "CPU" },
  ];
  const operatingBranches = branchList.filter((branch) => branch.code !== "HO");

  await seedShifts(operatingBranches.map((branch) => branch.id));

  console.log("Staff…");
  const users = await seedUsers(branches);

  console.log("Catalogue…");
  const catalogue = await seedCatalogue();

  console.log("Inventory…");
  const items = await seedInventory(operatingBranches.map((branch) => branch.id));

  console.log("Suppliers & purchases…");
  await seedSuppliers(
    branches.branch1.id,
    items,
    users.find((user) => user.employeeCode === "EMP0003")!.id,
  );

  console.log("Corporate accounts…");
  const b2bAccounts = await seedB2B(
    branches.branch1.id,
    catalogue.services,
    catalogue.garmentTypes,
  );

  console.log("Notification templates…");
  await seedNotificationTemplates();

  console.log("Orders & garments…");
  const orders = await seedOrders({
    branches: operatingBranches,
    services: catalogue.services.map((service) => ({
      id: service.id,
      code: service.code,
      pricingMode: service.pricingMode,
      basePrice: service.basePrice,
      stages: service.stages as string[],
      turnaroundHours: service.turnaroundHours,
    })),
    garmentTypes: catalogue.garmentTypes,
    users,
    b2bAccounts: b2bAccounts.map((account) => ({
      id: account.id,
      code: account.code,
      businessName: account.businessName,
      phone: account.phone,
    })),
  });

  console.log("Complaints…");
  await seedComplaints(orders, users);

  console.log("Expenses & attendance…");
  await seedExpensesAndAttendance(branchList, users);

  console.log("\nDone. Sign in on the access-code screen with any of these:");
  console.log("  900001   Platform Super Admin (cross-firm, /firms)");
  console.log("  100001   Firm Admin    (Ravi Anand)");
  console.log("  200001   Manager       (Sunita Rao — Head Office)");
  console.log("  200002   Manager       (Deepak Menon — Branch 1)");
  console.log("  200003   Manager       (Rekha Pillai — Branch 2)");
  console.log("  200004   Manager       (Nandini Bhat — Finance)");
  console.log("  300001   Scanner       (Anjali Verma — Branch 1 counter)");
  console.log("  300002   Scanner       (Suresh Kumar — Branch 2 counter)");
  console.log("  300003   Scanner       (Mahesh Gowda — Washing)");
  console.log("  300004   Scanner       (Lalita Devi — Ironing)");
  console.log("  300005   Scanner       (Fatima Sheikh — QC)");
  console.log("  300006   Scanner       (Joseph Dsouza — Packing)");
  console.log("  300007   Scanner       (Ganesh Naik — Delivery)");
  console.log("  300008   Scanner       (Prakash Shetty — Delivery)");
  console.log("  300009   Scanner       (Imtiaz Ali — CPU)");
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
