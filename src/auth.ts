import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { resolvePermissions } from "@/lib/permissions.server";
import { authenticateAccessCode, clientIp, logLoginEvent } from "@/lib/login-security";
import { isPlatformRole } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { verifyCustomerOtp, verifyCustomerToken } from "@/lib/customer-auth";
import type { PermissionCode } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

const credentialsSchema = z.object({
  accessCode: z.string().trim().min(1),
});

const customerSchema = z.object({
  mode: z.enum(["otp", "token"]),
  firmCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  code: z.string().trim().optional(),
  token: z.string().trim().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "customer",
      name: "customer",
      credentials: {},
      async authorize(raw, request) {
        const parsed = customerSchema.safeParse(raw);
        if (!parsed.success) return null;
        const ip = clientIp(request.headers);
        const { mode, firmCode, phone, code, token } = parsed.data;
        const identity =
          mode === "token"
            ? token ? await verifyCustomerToken(token, ip) : null
            : firmCode && phone && code ? await verifyCustomerOtp({ firmCode, phone, code, ip }) : null;
        if (!identity) return null;
        return {
          // Namespaced so a customer session can never be mistaken for a staff user id.
          id: `customer:${identity.customerId}`,
          name: identity.name,
          email: null,
          role: "CUSTOMER" as const,
          customerId: identity.customerId,
          branchId: null,
          permissions: [],
          firmId: identity.firmId,
          firmName: identity.firmName,
          activeFirmId: identity.firmId,
          activeFirmName: identity.firmName,
        };
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        accessCode: { label: "Access code", type: "text" },
      },
      async authorize(raw, request) {
        try {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;

          const user = await authenticateAccessCode(parsed.data.accessCode, {
            ip: clientIp(request.headers),
            userAgent: request.headers.get("user-agent"),
          });
          if (!user) return null;

          const permissions = await resolvePermissions(user.id, user.role);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
            branchId: user.branchId,
            branchName: user.branch?.name ?? null,
            branchCode: user.branch?.code ?? null,
            employeeCode: user.employeeCode,
            permissions,
            firmId: user.firmId,
            firmName: user.firm?.name ?? null,
            // A firm user's active firm is always their own, fixed firm. A
            // PLATFORM_SUPER_ADMIN starts with none and must explicitly enter
            // one from the platform dashboard.
            activeFirmId: isPlatformRole(user.role) ? null : user.firmId,
            activeFirmName: isPlatformRole(user.role) ? null : (user.firm?.name ?? null),
          };
        } catch (err) {
          console.error("[NextAuth Authorize Error]:", err);
          throw err;
        }
      },
    }),
  ],
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (token?.id) {
        await logLoginEvent({
          event: "LOGOUT",
          userId: token.id as string,
          firmId: (token.firmId as string | null) ?? null,
        });
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.branchId = user.branchId;
        token.branchName = user.branchName;
        token.branchCode = user.branchCode;
        token.employeeCode = user.employeeCode;
        token.permissions = user.permissions;
        token.firmId = user.firmId;
        token.firmName = user.firmName;
        token.activeFirmId = user.activeFirmId;
        token.activeFirmName = user.activeFirmName;
        token.customerId = (user as { customerId?: string }).customerId ?? null;
      }

      // Re-read role/branch/permissions when the client explicitly asks for a
      // refresh (e.g. after an admin changes this user's access), and handle
      // the Firms-module "enter firm" switch (PLATFORM_SUPER_ADMIN only — a
      // regular firm user's token.firmId never changes here).
      if (trigger === "update" && token.id && token.role !== "CUSTOMER") {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            firm: { select: { id: true, name: true } },
          },
        });
        if (fresh && fresh.status === "ACTIVE") {
          token.role = fresh.role;
          token.branchId = fresh.branchId;
          token.branchName = fresh.branch?.name ?? null;
          token.branchCode = fresh.branch?.code ?? null;
          token.permissions = await resolvePermissions(fresh.id, fresh.role);
          token.firmId = fresh.firmId;
          token.firmName = fresh.firm?.name ?? null;
        }

        const requestedFirmId = (updateData as { activeFirmId?: string | null } | undefined)?.activeFirmId;
        if (requestedFirmId !== undefined && isPlatformRole(token.role as UserRole)) {
          if (requestedFirmId === null) {
            token.activeFirmId = null;
            token.activeFirmName = null;
          } else {
            const targetFirm = await prisma.firm.findUnique({
              where: { id: requestedFirmId },
              select: { id: true, name: true, status: true },
            });
            // Silently ignored (not thrown) if the firm doesn't exist —
            // this is a session-update trigger, not a page action; the
            // Firms-module UI itself validates before calling it.
            if (targetFirm && targetFirm.status === "ACTIVE") {
              token.activeFirmId = targetFirm.id;
              token.activeFirmName = targetFirm.name;
              await recordAudit({
                userId: token.id as string,
                firmId: targetFirm.id,
                action: "PLATFORM_ENTER_FIRM",
                entity: "Firm",
                entityId: targetFirm.id,
                summary: `Platform Super Admin entered ${targetFirm.name}`,
              }).catch(() => {});
            }
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.branchId = (token.branchId as string | null) ?? null;
        session.user.branchName = (token.branchName as string | null) ?? null;
        session.user.branchCode = (token.branchCode as string | null) ?? null;
        session.user.employeeCode = (token.employeeCode as string | null) ?? null;
        session.user.permissions = (token.permissions as PermissionCode[]) ?? [];
        session.user.firmId = (token.firmId as string | null) ?? null;
        session.user.firmName = (token.firmName as string | null) ?? null;
        session.user.activeFirmId = (token.activeFirmId as string | null) ?? null;
        session.user.activeFirmName = (token.activeFirmName as string | null) ?? null;
        session.user.customerId = (token.customerId as string | null) ?? null;
      }
      return session;
    },
  },
});
