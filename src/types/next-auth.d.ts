import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/lib/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      branchId: string | null;
      branchName: string | null;
      branchCode: string | null;
      employeeCode: string | null;
      permissions: PermissionCode[];
      firmId: string | null;
      firmName: string | null;
      activeFirmId: string | null;
      activeFirmName: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    branchId: string | null;
    branchName?: string | null;
    branchCode?: string | null;
    employeeCode?: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName?: string | null;
    activeFirmId: string | null;
    activeFirmName?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    branchId: string | null;
    branchName: string | null;
    branchCode: string | null;
    employeeCode: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName: string | null;
    activeFirmId: string | null;
    activeFirmName: string | null;
  }
}
