"use client";

import { useState } from "react";
import { Activity, Calendar, Filter, Search, UserCheck, ShieldCheck, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/dates";

import type { AuditLogRow } from "@/lib/services/audit-log";

interface Props {
  logs: AuditLogRow[];
}

const ACTION_COLORS: Record<string, string> = {
  ORDER_CREATED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  ORDER_UPDATED: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  PAYMENT_RECORDED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  GARMENT_STAGE_ADVANCED: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  GARMENT_SCANNED: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  BATCH_SCAN_EXCEPTION: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  USER_LOGIN: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  TAGS_PRINTED: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  DELIVERY_COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
};

export function ActivityLogView({ logs }: Props) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");

  const filtered = logs.filter((log) => {
    const matchesAction = actionFilter === "ALL" || log.action === actionFilter;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      log.userName.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.entity.toLowerCase().includes(q) ||
      (log.summary && log.summary.toLowerCase().includes(q));
    return matchesAction && matchesSearch;
  });

  const uniqueActions = Array.from(new Set(logs.map((l) => l.action))).sort();

  return (
    <div className="space-y-5">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by user, action, entity or summary..."
            className="pl-9 h-9"
          />
        </div>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-56 h-9">
            <SelectValue placeholder="Action filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Actions</SelectItem>
            {uniqueActions.map((act) => (
              <SelectItem key={act} value={act}>
                {act.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Audit Log Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">User & Role</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Record / Entity</th>
                  <th className="px-4 py-3">Summary Details</th>
                  <th className="px-4 py-3 text-right">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No system activity logs match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-mono">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground text-xs">{log.userName}</div>
                        <Badge tone="neutral" className="text-[10px] font-normal mt-0.5">
                          {log.userRole}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-semibold ${
                            ACTION_COLORS[log.action] || "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {log.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-medium">{log.entity}</span>
                        {log.entityId && (
                          <span className="font-mono text-muted-foreground block text-[11px]">
                            {log.entityId.slice(0, 16)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground font-medium">
                        {log.summary || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {log.ipAddress || "local"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
