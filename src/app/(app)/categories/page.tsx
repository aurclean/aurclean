import Link from "next/link";
import { Layers, Shapes, Shirt, Tag } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";

export const metadata = { title: "Garment & Service Categories" };

export default async function CategoriesPage() {
  const user = await requirePermission(PERMISSIONS.CATALOGUE_MANAGE);
  const firmId = requireFirmId(user);

  const [garmentTypes, services] = await Promise.all([
    prisma.garmentType.findMany({
      where: { firmId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { orderItems: true, garments: true } },
      },
    }),
    prisma.service.findMany({
      where: { firmId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { orderItems: true, garments: true } },
      },
    }),
  ]);

  // Group garment types by category
  const categoriesMap = new Map<string, typeof garmentTypes>();
  for (const item of garmentTypes) {
    const cat = item.category || "General";
    const existing = categoriesMap.get(cat) || [];
    existing.push(item);
    categoriesMap.set(cat, existing);
  }

  const garmentCategories = Array.from(categoriesMap.entries()).map(
    ([name, items]) => ({
      name,
      itemCount: items.length,
      activeCount: items.filter((i) => i.isActive).length,
      totalOrders: items.reduce((acc, i) => acc + i._count.orderItems, 0),
      items,
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories & Classifications"
        description="Manage garment categories, material types, and service classifications across operations."
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/services">
            <Tag className="mr-2 h-4 w-4" /> Manage Catalogue
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Garment Categories
            </CardTitle>
            <Shapes className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{garmentCategories.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Active groupings
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Garment Types
            </CardTitle>
            <Shirt className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{garmentTypes.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {garmentTypes.filter((g) => g.isActive).length} active items
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Service Types
            </CardTitle>
            <Tag className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{services.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {services.filter((s) => s.isActive).length} active services
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Order Uses
            </CardTitle>
            <Layers className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {garmentTypes.reduce((sum, g) => sum + g._count.orderItems, 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tagged items in system
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
            <Shapes className="h-5 w-5 text-emerald-500" /> Garment Categories
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {garmentCategories.map((cat) => (
              <Card key={cat.name} className="border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">
                      {cat.name}
                    </CardTitle>
                    <Badge tone="neutral">{cat.itemCount} types</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {cat.items.slice(0, 8).map((item) => (
                      <Badge
                        key={item.id}
                        tone={item.isActive ? "outline" : "neutral"}
                        className="text-xs font-normal"
                      >
                        {item.name}
                      </Badge>
                    ))}
                    {cat.items.length > 8 && (
                      <Badge tone="neutral" className="text-xs">
                        +{cat.items.length - 8} more
                      </Badge>
                    )}
                  </div>
                  <div className="pt-2 border-t text-xs text-muted-foreground flex justify-between">
                    <span>Active: {cat.activeCount}</span>
                    <span>Processed: {cat.totalOrders} items</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold tracking-tight mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5 text-indigo-500" /> Service Classifications
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id} className="border-border/60">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">
                      {service.name}
                    </CardTitle>
                    <Badge tone={service.isActive ? "success" : "neutral"}>
                      {service.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {service.description || "No description provided."}
                  </p>
                  <div className="pt-2 border-t text-xs text-muted-foreground flex justify-between">
                    <span>Code: {service.code || "N/A"}</span>
                    <span>Orders: {service._count.orderItems}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
