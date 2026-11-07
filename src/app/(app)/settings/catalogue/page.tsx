import Link from "next/link";
import { ArrowLeft, Eye, Shirt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { RowActions } from "@/components/shared/row-actions";
import {
  archiveGarmentTypeAction,
  archiveServiceAction,
} from "@/app/(app)/settings/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  GarmentTypeDialog,
  RateInput,
  ServiceDialog,
} from "@/app/(app)/settings/settings-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/workflow";
import type { ProcessingStage } from "@/generated/prisma/enums";

export const metadata = { title: "Catalogue" };

export default async function CataloguePage() {
  const user = await requirePermission(PERMISSIONS.CATALOGUE_MANAGE);
  const firmId = requireFirmId(user);

  const [services, garmentTypes, rates] = await Promise.all([
    prisma.service.findMany({
      where: { firmId },
      orderBy: { name: "asc" },
      include: { _count: { select: { orderItems: true, garments: true } } },
    }),
    prisma.garmentType.findMany({
      where: { firmId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { _count: { select: { orderItems: true, garments: true } } },
    }),
    prisma.serviceRate.findMany({ where: { service: { firmId } } }),
  ]);

  /** How many places a catalogue entry is already referenced from. */
  const serviceUsage = (entry: {
    _count: { orderItems: number; garments: number };
  }) => entry._count.orderItems + entry._count.garments;

  const rateMap = new Map(
    rates.map((rate) => [
      `${rate.serviceId}:${rate.garmentTypeId}`,
      num(rate.price),
    ]),
  );

  const activeServices = services.filter((service) => service.isActive);
  const activeTypes = garmentTypes.filter((type) => type.isActive);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Services & garments"
        description="The catalogue the counter prices orders from."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="icon"
              aria-label="Back to settings"
            >
              <Link href="/settings">
                <ArrowLeft />
              </Link>
            </Button>
            <GarmentTypeDialog />
            <ServiceDialog />
          </>
        }
      />

      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">
            Services ({services.length})
          </TabsTrigger>
          <TabsTrigger value="garments">
            Garment types ({garmentTypes.length})
          </TabsTrigger>
          <TabsTrigger value="rates">Rate matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          {services.length === 0 ? (
            <EmptyState
              icon={Shirt}
              title="No services"
              description="Add the services you offer — wash and fold, dry clean, ironing…"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => (
                <Card key={service.id} className="lift">
                  <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {service.name}
                      </CardTitle>
                      <p className="font-mono text-xs text-muted-foreground">
                        {service.code}
                      </p>
                    </div>
                    <StatusBadge
                      status={service.isActive ? "ACTIVE" : "INACTIVE"}
                    />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-semibold numeric">
                        {formatCurrency(service.basePrice)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {humanize(service.pricingMode)} ·{" "}
                        {service.turnaroundHours}h
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {service.stages.map((stage) => (
                        <Badge key={stage} tone="neutral">
                          {STAGE_LABELS[stage as ProcessingStage]}
                        </Badge>
                      ))}
                    </div>
                    {service.description ? (
                      <p className="text-xs text-muted-foreground">
                        {service.description}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/settings/catalogue/${service.id}`}>
                          <Eye /> View
                        </Link>
                      </Button>
                      <ServiceDialog
                        service={{
                          id: service.id,
                          code: service.code,
                          name: service.name,
                          description: service.description,
                          pricingMode: service.pricingMode,
                          basePrice: num(service.basePrice),
                          turnaroundHours: service.turnaroundHours,
                          stages: service.stages as string[],
                          isActive: service.isActive,
                        }}
                      />
                      <RowActions
                        compact
                        remove={{
                          subject: service.name,
                          confirmLabel:
                            serviceUsage(service) > 0
                              ? "Retire service"
                              : "Delete service",
                          successMessage:
                            serviceUsage(service) > 0
                              ? `${service.name} retired`
                              : `${service.name} deleted`,
                          impact:
                            serviceUsage(service) > 0 ? (
                              <>
                                <p>
                                  {service.name} is on {serviceUsage(service)}{" "}
                                  order line
                                  {serviceUsage(service) === 1 ? "" : "s"}, so
                                  it is taken off the booking form and kept on
                                  the record.
                                </p>
                                <p>
                                  Those orders still read exactly as they were
                                  sold.
                                </p>
                              </>
                            ) : (
                              <p>
                                Nothing has ever been booked against this
                                service, so it is removed along with its rate
                                card.
                              </p>
                            ),
                          action: archiveServiceAction.bind(null, {
                            id: service.id,
                          }),
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="garments">
          {garmentTypes.length === 0 ? (
            <EmptyState
              icon={Shirt}
              title="No garment types"
              description="Add shirts, trousers, sarees, linen — whatever you take in."
            />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">Garment</th>
                      <th className="px-4 py-2.5 text-left">Category</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {garmentTypes.map((type) => (
                      <tr
                        key={type.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{type.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {type.code}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {humanize(type.category)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge
                            status={type.isActive ? "ACTIVE" : "INACTIVE"}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <GarmentTypeDialog
                              garmentType={{
                                id: type.id,
                                code: type.code,
                                name: type.name,
                                category: type.category,
                                isActive: type.isActive,
                              }}
                            />
                            <RowActions
                              compact
                              remove={{
                                subject: type.name,
                                confirmLabel:
                                  serviceUsage(type) > 0
                                    ? "Retire type"
                                    : "Delete type",
                                successMessage:
                                  serviceUsage(type) > 0
                                    ? `${type.name} retired`
                                    : `${type.name} deleted`,
                                impact:
                                  serviceUsage(type) > 0 ? (
                                    <p>
                                      {serviceUsage(type)} order line
                                      {serviceUsage(type) === 1 ? "" : "s"} name
                                      this type, so it comes off the booking
                                      form and stays on the record.
                                    </p>
                                  ) : (
                                    <p>
                                      Nothing has ever been booked as this type,
                                      so it is removed along with its rates.
                                    </p>
                                  ),
                                action: archiveGarmentTypeAction.bind(null, {
                                  id: type.id,
                                }),
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rates">
          {activeServices.length === 0 || activeTypes.length === 0 ? (
            <EmptyState
              title="Nothing to price yet"
              description="Add at least one active service and one active garment type."
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Rate per garment type</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Leave a cell at zero to fall back to the service&apos;s base
                  price. Corporate contracts override both.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto scrollbar-thin p-0">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 bg-card px-4 py-2.5 text-left">
                        Garment
                      </th>
                      {activeServices.map((service) => (
                        <th key={service.id} className="px-3 py-2.5 text-right">
                          {service.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeTypes.map((type) => (
                      <tr
                        key={type.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="sticky left-0 bg-card px-4 py-2">
                          <p className="whitespace-nowrap font-medium">
                            {type.name}
                          </p>
                        </td>
                        {activeServices.map((service) => (
                          <td key={service.id} className="px-3 py-2 text-right">
                            <RateInput
                              serviceId={service.id}
                              garmentTypeId={type.id}
                              price={
                                rateMap.get(`${service.id}:${type.id}`) ?? null
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
