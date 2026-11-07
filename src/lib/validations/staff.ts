import { z } from "zod";

import {
  cuidSchema,
  dateSchema,
  moneySchema,
  optionalCuid,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalText,
} from "@/lib/validations/common";

export const userRoleSchema = z.enum(["SUPER_ADMIN", "MANAGER", "SCANNER"]);

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  phone: optionalPhone,
  role: userRoleSchema,
  branchId: optionalCuid,
  department: optionalText(80),
  designation: optionalText(80),
  dateOfJoining: optionalDate,
  monthlySalary: moneySchema.default(0),
  shiftId: optionalCuid,
  emergencyContact: optionalPhone,
  addressLine: optionalText(300),
  // Driver-only fields
  licenseNumber: optionalText(40),
  vehicleNumber: optionalText(20),
  vehicleType: optionalText(40),
});

export const updateStaffSchema = z.object({
  userId: cuidSchema,
  name: z.string().trim().min(2).max(120),
  phone: optionalPhone,
  email: z.string().trim().toLowerCase().email(),
  role: userRoleSchema,
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
  branchId: optionalCuid,
  department: optionalText(80),
  designation: optionalText(80),
  monthlySalary: moneySchema.default(0),
  shiftId: optionalCuid,
  emergencyContact: optionalPhone,
  addressLine: optionalText(300),
});

export const regenerateAccessCodeSchema = z.object({
  userId: cuidSchema,
});

export const permissionOverrideSchema = z.object({
  userId: cuidSchema,
  permissionCode: z.string().min(1),
  granted: z.boolean(),
});

export const attendanceSchema = z.object({
  userId: cuidSchema,
  date: dateSchema,
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "WEEKLY_OFF", "HOLIDAY"]),
  checkIn: optionalText(5),
  checkOut: optionalText(5),
  notes: optionalText(300),
});

export const leaveSchema = z.object({
  userId: cuidSchema,
  type: z.enum(["CASUAL", "SICK", "EARNED", "UNPAID", "MATERNITY"]),
  fromDate: dateSchema,
  toDate: dateSchema,
  reason: optionalText(500),
});

export const leaveDecisionSchema = z.object({
  leaveId: cuidSchema,
  status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
});
