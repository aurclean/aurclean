import "server-only";

import { prisma } from "@/lib/prisma";
import type { LoginEventType } from "@/generated/prisma/enums";

/**
 * Read models for the platform administrator. They are aggregates and
 * credential *status* only: no query here selects accessCode, accessCodeHash
 * or any token column, so no secret can reach a page or API response.
 */

export interface CodeStatus {
  state: "ACTIVE" | "REVOKED";
  issuedAt: Date | null;
  lastAction: LoginEventType | null;
  lastActionAt: Date | null;
  lastActionBy: string | null;
}

const CODE_EVENTS: LoginEventType[] = ["CODE_ISSUED", "CODE_REGENERATED", "CODE_REVOKED"];

/** Latest code event per user, with the name of whoever performed it. */
export async function getCodeStatuses(
  users: Array<{ id: string; accessCodeHash: string | null; accessCodeIssuedAt: Date | null }>,
): Promise<Map<string, CodeStatus>> {
  const ids = users.map((u) => u.id);
  const events = ids.length
    ? await prisma.loginEvent.findMany({
        where: { userId: { in: ids }, event: { in: CODE_EVENTS } },
        orderBy: { createdAt: "desc" },
        select: { userId: true, event: true, createdAt: true, actorId: true },
      })
    : [];
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) if (e.userId && !latest.has(e.userId)) latest.set(e.userId, e);

  const actorIds = [...new Set([...latest.values()].map((e) => e.actorId).filter(Boolean) as string[])];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  return new Map(
    users.map((u) => {
      const e = latest.get(u.id);
      return [
        u.id,
        {
          state: u.accessCodeHash ? "ACTIVE" : "REVOKED",
          issuedAt: u.accessCodeIssuedAt,
          lastAction: e?.event ?? null,
          lastActionAt: e?.createdAt ?? null,
          lastActionBy: e?.actorId ? (actorName.get(e.actorId) ?? "Removed user") : null,
        } satisfies CodeStatus,
      ];
    }),
  );
}

export function describeCodeStatus(s: CodeStatus): string {
  if (s.state === "REVOKED") return "Revoked — no sign-in until a new code is issued";
  const verb = s.lastAction === "CODE_REGENERATED" ? "Reissued" : "Issued";
  const when = (s.lastActionAt ?? s.issuedAt)?.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `Active · ${verb}${when ? ` ${when}` : ""}${s.lastActionBy ? ` by ${s.lastActionBy}` : ""}`;
}

/** One row per firm for the platform dashboard. */
export async function getFirmDirectory() {
  const [firms, managers, userCounts, staffCounts, customerCounts] = await Promise.all([
    prisma.firm.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, status: true } }),
    prisma.user.findMany({
      where: { role: "FIRM_MANAGER", firmId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, firmId: true, name: true, status: true, accessCodeHash: true, accessCodeIssuedAt: true },
    }),
    prisma.user.groupBy({ by: ["firmId"], where: { firmId: { not: null } }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ["firmId"], where: { firmId: { not: null }, role: { in: ["FIELD_MANAGER", "QC"] } }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["firmId"], _count: { _all: true } }),
  ]);
  const statuses = await getCodeStatuses(managers);
  const n = (rows: Array<{ firmId: string | null; _count: { _all: number } }>, id: string) => rows.find((r) => r.firmId === id)?._count._all ?? 0;

  return firms.map((firm) => {
    const mine = managers.filter((m) => m.firmId === firm.id);
    return {
      ...firm,
      managers: mine.map((m) => ({ id: m.id, name: m.name, status: m.status, code: statuses.get(m.id)! })),
      totalUsers: n(userCounts, firm.id) + n(customerCounts, firm.id),
      totalStaff: n(staffCounts, firm.id),
    };
  });
}
