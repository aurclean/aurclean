"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Receipt, Search, ShoppingBag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

interface SaleRow {
  id: string;
  orderNumber: string;
  salesReference: string;
  customerName: string;
  placedAt: string;
  itemCount: number;
  subtotal: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: string;
}

interface Props {
  sales: SaleRow[];
}

export function SalesView({ sales }: Props) {
  const [search, setSearch] = useState("");

  const filtered = sales.filter(
    (s) =>
      !search ||
      s.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      s.salesReference.toLowerCase().includes(search.toLowerCase()) ||
      s.customerName.toLowerCase().includes(search.toLowerCase()),
  );

  const totalSalesRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);

  return (
    <div className="space-y-5">
      {/* Header Summary */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-primary">Total Gross Sales Revenue</span>
            <p className="text-3xl font-extrabold font-mono text-primary mt-1">
              {formatCurrency(totalSalesRevenue)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{sales.length} billed laundry sales orders</p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShoppingBag className="size-6" />
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sales by order number, sales ref (SAL-XXXX), customer..."
          className="pl-9 h-9 font-mono"
        />
      </div>

      {/* Sales Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Sales Ref</th>
                  <th className="px-4 py-3">Order #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                  <th className="px-4 py-3 text-right">Discount</th>
                  <th className="px-4 py-3 text-right">Total Sale</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-muted-foreground">
                      No sales orders found matching filter criteria.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{s.salesReference}</td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{s.orderNumber}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(s.placedAt)}</td>
                      <td className="px-4 py-3 font-medium text-xs">{s.customerName}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{s.itemCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(s.subtotal)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-rose-500">
                        {s.discount > 0 ? `-${formatCurrency(s.discount)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(s.totalAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-emerald-600 font-semibold">
                        {formatCurrency(s.paidAmount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge tone={s.paymentStatus === "PAID" ? "success" : "warning"} className="text-[10px]">
                          {s.paymentStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="ghost" className="size-8">
                          <Link href={`/orders/${s.id}`}>
                            <ExternalLink className="size-3.5" />
                          </Link>
                        </Button>
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
