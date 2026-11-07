"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FormError, FormField } from "@/components/shared/form-field";
import { formatCurrency } from "@/lib/money";
import { createOrderAction, quoteOrderAction } from "@/app/(app)/orders/actions";
import type { FieldErrors } from "@/lib/action-result";
import { signalDataChange } from "@/components/shared/live-refresh";
import {
  CustomerPicker,
  type PickedCustomer,
} from "@/app/(app)/orders/new/customer-picker";

export interface ServiceOption {
  id: string;
  name: string;
  pricingMode: string;
  basePrice: number;
  turnaroundHours: number;
}

export interface GarmentTypeOption {
  id: string;
  name: string;
  category: string;
}

export interface BranchOption {
  id: string;
  name: string;
  code: string;
}

export interface B2BOption {
  id: string;
  businessName: string;
  code: string;
}

interface LineItem {
  key: string;
  serviceId: string;
  garmentTypeId: string;
  quantity: number;
  weightKg: number;
  notes: string;
  unitPrice: number;
  lineTotal: number;
  pricingMode: string;
}

interface OrderFormProps {
  initialCustomer: PickedCustomer | null;
  services: ServiceOption[];
  garmentTypes: GarmentTypeOption[];
  branches: BranchOption[];
  b2bAccounts: B2BOption[];
  defaultBranchId: string | null;
  canDiscount: boolean;
  defaultGstRate: number;
}

const newLine = (services: ServiceOption[], garmentTypes: GarmentTypeOption[]): LineItem => ({
  key: crypto.randomUUID(),
  serviceId: services[0]?.id ?? "",
  garmentTypeId: garmentTypes[0]?.id ?? "",
  quantity: 1,
  weightKg: 0,
  notes: "",
  unitPrice: 0,
  lineTotal: 0,
  pricingMode: services[0]?.pricingMode ?? "PER_PIECE",
});

function defaultDueDate(hours: number): string {
  const due = new Date(Date.now() + hours * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

export function OrderForm({
  initialCustomer,
  services,
  garmentTypes,
  branches,
  b2bAccounts,
  defaultBranchId,
  canDiscount,
  defaultGstRate,
}: OrderFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? "");
  const [type, setType] = useState("WALK_IN");
  const [priority, setPriority] = useState("NORMAL");
  const [b2bAccountId, setB2bAccountId] = useState("none");

  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const [customerName, setCustomerName] = useState(initialCustomer?.name ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomer?.phone ?? "");
  const [customerEmail, setCustomerEmail] = useState(initialCustomer?.email ?? "");
  const [addressLine, setAddressLine] = useState(initialCustomer?.addressLine ?? "");
  const [city, setCity] = useState(initialCustomer?.city ?? "");
  const [pincode, setPincode] = useState(initialCustomer?.pincode ?? "");
  const [landmark, setLandmark] = useState(initialCustomer?.landmark ?? "");

  const applyCustomer = (picked: PickedCustomer) => {
    setCustomer(picked);
    setCustomerName(picked.name);
    setCustomerPhone(picked.phone);
    setCustomerEmail(picked.email ?? "");
    setAddressLine(picked.addressLine ?? "");
    setCity(picked.city ?? "");
    setPincode(picked.pincode ?? "");
    setLandmark(picked.landmark ?? "");
  };

  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(() =>
    defaultDueDate(services[0]?.turnaroundHours ?? 48),
  );
  const [pickupScheduledAt, setPickupScheduledAt] = useState("");

  const [items, setItems] = useState<LineItem[]>(() => [newLine(services, garmentTypes)]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [gstRate, setGstRate] = useState(defaultGstRate);
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [advanceMethod, setAdvanceMethod] = useState("CASH");

  const [specialInstructions, setSpecialInstructions] = useState("");
  const [stainNotes, setStainNotes] = useState("");
  const [damageNotes, setDamageNotes] = useState("");

  const [totals, setTotals] = useState({
    subtotal: 0,
    discountAmount: 0,
    taxableAmount: 0,
    gstAmount: 0,
    totalAmount: 0,
  });

  const serviceById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );

  // Re-price from the server whenever the basket changes, so the counter always
  // sees the same numbers the server will persist (B2B rate cards included).
  const quoteKey = JSON.stringify({
    items: items.map((item) => ({
      serviceId: item.serviceId,
      garmentTypeId: item.garmentTypeId,
      quantity: item.quantity,
      weightKg: item.weightKg,
    })),
    b2bAccountId,
    discountAmount,
    gstRate,
  });

  useEffect(() => {
    const payload = JSON.parse(quoteKey) as {
      items: { serviceId: string; garmentTypeId: string; quantity: number; weightKg: number }[];
      b2bAccountId: string;
      discountAmount: number;
      gstRate: number;
    };

    const valid = payload.items.filter((item) => item.serviceId && item.garmentTypeId);
    if (valid.length === 0) {
      setTotals({
        subtotal: 0,
        discountAmount: 0,
        taxableAmount: 0,
        gstAmount: 0,
        totalAmount: 0,
      });
      return;
    }

    let cancelled = false;
    void quoteOrderAction({
      items: valid,
      b2bAccountId: payload.b2bAccountId === "none" ? null : payload.b2bAccountId,
      discountAmount: payload.discountAmount,
      gstRate: payload.gstRate,
    }).then((result) => {
      if (cancelled || !result.ok) return;
      setTotals({
        subtotal: result.data.subtotal,
        discountAmount: result.data.discountAmount,
        taxableAmount: result.data.taxableAmount,
        gstAmount: result.data.gstAmount,
        totalAmount: result.data.totalAmount,
      });
      setItems((current) =>
        current.map((item, index) => {
          const line = result.data.lines[index];
          return line
            ? {
                ...item,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
                pricingMode: line.pricingMode,
              }
            : item;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [quoteKey]);

  const updateItem = (key: string, patch: Partial<LineItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  /**
   * Where to go after a successful booking. A counter working through a queue
   * wants the form back and empty; one booking a single order wants to see it
   * and print the tag.
   */
  const [after, setAfter] = useState<"view" | "again">("view");

  const resetForNext = () => {
    setCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setAddressLine("");
    setCity("");
    setPincode("");
    setLandmark("");
    setItems([newLine(services, garmentTypes)]);
    setDiscountAmount(0);
    setDiscountReason("");
    setAdvanceAmount(0);
    setSpecialInstructions("");
    setStainNotes("");
    setDamageNotes("");
    setPickupScheduledAt("");
    setFormError(null);
    setFieldErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = () => {
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createOrderAction({
        branchId,
        type,
        priority,
        customerId: customer?.id ?? null,
        customerName,
        customerPhone,
        customerEmail,
        addressLine,
        city,
        pincode,
        landmark,
        b2bAccountId: b2bAccountId === "none" ? null : b2bAccountId,
        expectedDeliveryAt,
        items: items.map((item) => ({
          serviceId: item.serviceId,
          garmentTypeId: item.garmentTypeId,
          quantity: item.quantity,
          weightKg: item.weightKg,
          notes: item.notes,
        })),
        discountAmount,
        discountReason,
        gstRate,
        advanceAmount,
        advanceMethod,
        specialInstructions,
        stainNotes,
        damageNotes,
        pickupScheduledAt: pickupScheduledAt || null,
      });

      if (result.ok) {
        toast.success(
          `${result.data.orderNumber} created with ${result.data.garmentCount} tagged garments`,
        );
        signalDataChange();
        if (after === "again") {
          resetForNext();
          toast.message("Ready for the next one", {
            description: `${result.data.orderNumber} is on the orders list.`,
            action: {
              label: "Open it",
              onClick: () => router.push(`/orders/${result.data.id}`),
            },
          });
        } else {
          router.push(`/orders/${result.data.id}`);
        }
      } else {
        setFormError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  };

  const needsAddress = type !== "WALK_IN";
  const totalPieces = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <form
      className="grid grid-cols-1 gap-5 lg:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-5 lg:col-span-2">
        {formError ? <FormError message={formError} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Customer & booking</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CustomerPicker
                selected={customer}
                onSelect={applyCustomer}
                onClear={() => setCustomer(null)}
              />
            </div>

            <FormField label="Customer name" htmlFor="customerName" required error={fieldErrors.customerName}>
              <Input
                id="customerName"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="e.g. Priya Sharma"
                required
              />
            </FormField>

            <FormField label="Phone number" htmlFor="customerPhone" required error={fieldErrors.customerPhone}>
              <Input
                id="customerPhone"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="9876543210"
                inputMode="tel"
                required
              />
            </FormField>

            <FormField label="Email" htmlFor="customerEmail" error={fieldErrors.customerEmail}>
              <Input
                id="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                placeholder="optional"
              />
            </FormField>

            <FormField label="Order type">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WALK_IN">Walk-in</SelectItem>
                  <SelectItem value="PICKUP">Pickup</SelectItem>
                  <SelectItem value="DELIVERY">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {needsAddress ? (
              <>
                <FormField
                  label="Address"
                  htmlFor="addressLine"
                  required
                  className="sm:col-span-2"
                  error={fieldErrors.addressLine}
                >
                  <Textarea
                    id="addressLine"
                    value={addressLine}
                    onChange={(event) => setAddressLine(event.target.value)}
                    placeholder="Flat / house, street, area"
                    required
                  />
                </FormField>
                <FormField label="City" htmlFor="city">
                  <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
                </FormField>
                <FormField label="Pincode" htmlFor="pincode">
                  <Input
                    id="pincode"
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    inputMode="numeric"
                  />
                </FormField>
                <FormField label="Landmark" htmlFor="landmark" className="sm:col-span-2">
                  <Input
                    id="landmark"
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    placeholder="Near…"
                  />
                </FormField>
              </>
            ) : null}

            {type === "PICKUP" ? (
              <FormField label="Pickup scheduled for" htmlFor="pickupScheduledAt" className="sm:col-span-2">
                <Input
                  id="pickupScheduledAt"
                  type="datetime-local"
                  value={pickupScheduledAt}
                  onChange={(event) => setPickupScheduledAt(event.target.value)}
                />
              </FormField>
            ) : null}

            {branches.length > 1 ? (
              <FormField label="Branch" required>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name} ({branch.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}

            <FormField label="Priority">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="EXPRESS">Express</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="Expected delivery"
              htmlFor="expectedDeliveryAt"
              required
              error={fieldErrors.expectedDeliveryAt}
            >
              <Input
                id="expectedDeliveryAt"
                type="datetime-local"
                value={expectedDeliveryAt}
                onChange={(event) => setExpectedDeliveryAt(event.target.value)}
                required
              />
            </FormField>

            {b2bAccounts.length > 0 ? (
              <FormField
                label="Corporate account"
                hint="Applies the account's contracted rate card"
              >
                <Select value={b2bAccountId} onValueChange={setB2bAccountId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Retail customer</SelectItem>
                    {b2bAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.businessName} ({account.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Garments & services</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((current) => [...current, newLine(services, garmentTypes)])}
            >
              <Plus /> Add line
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {fieldErrors.items ? (
              <FormError message={fieldErrors.items[0]} />
            ) : null}

            {items.map((item, index) => {
              const service = serviceById.get(item.serviceId);
              const byWeight = service?.pricingMode === "PER_KG";
              return (
                <div
                  key={item.key}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-12"
                >
                  <div className="sm:col-span-4">
                    <FormField label="Service">
                      <Select
                        value={item.serviceId}
                        onValueChange={(value) =>
                          updateItem(item.key, {
                            serviceId: value,
                            pricingMode:
                              serviceById.get(value)?.pricingMode ?? "PER_PIECE",
                          })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
                        <SelectContent>
                          {services.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="sm:col-span-3">
                    <FormField label="Garment">
                      <Select
                        value={item.garmentTypeId}
                        onValueChange={(value) => updateItem(item.key, { garmentTypeId: value })}
                      >
                        <SelectTrigger><SelectValue placeholder="Garment" /></SelectTrigger>
                        <SelectContent>
                          {garmentTypes.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>

                  <div className="sm:col-span-2">
                    <FormField label="Pieces" hint="One tag per piece">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(item.key, {
                            quantity: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                      />
                    </FormField>
                  </div>

                  <div className="sm:col-span-2">
                    <FormField label={byWeight ? "Weight (kg) *" : "Weight (kg)"}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.weightKg}
                        onChange={(event) =>
                          updateItem(item.key, {
                            weightKg: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                    </FormField>
                  </div>

                  <div className="flex items-end justify-between gap-2 sm:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove line"
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((current) => current.filter((line) => line.key !== item.key))
                      }
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>

                  <div className="sm:col-span-9">
                    <Input
                      value={item.notes}
                      onChange={(event) => updateItem(item.key, { notes: event.target.value })}
                      placeholder="Line note — stains, special handling…"
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-end sm:col-span-3">
                    <p className="text-sm numeric">
                      <span className="text-muted-foreground">
                        {formatCurrency(item.unitPrice)} ×{" "}
                        {byWeight ? `${item.weightKg} kg` : item.quantity}
                      </span>
                      <span className="ml-2 font-semibold">
                        {formatCurrency(item.lineTotal)}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Special instructions">
              <Textarea
                value={specialInstructions}
                onChange={(event) => setSpecialInstructions(event.target.value)}
                placeholder="Handle with care, no starch…"
              />
            </FormField>
            <FormField label="Stain notes">
              <Textarea
                value={stainNotes}
                onChange={(event) => setStainNotes(event.target.value)}
                placeholder="Ink on left cuff…"
              />
            </FormField>
            <FormField label="Damage notes">
              <Textarea
                value={damageNotes}
                onChange={(event) => setDamageNotes(event.target.value)}
                placeholder="Loose button, small tear…"
              />
            </FormField>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-1">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Pieces</dt>
                <dd className="numeric font-medium">{totalPieces}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="numeric">{formatCurrency(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="numeric text-destructive">
                  −{formatCurrency(totals.discountAmount)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Taxable</dt>
                <dd className="numeric">{formatCurrency(totals.taxableAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">GST ({gstRate}%)</dt>
                <dd className="numeric">{formatCurrency(totals.gstAmount)}</dd>
              </div>
            </dl>

            <Separator />

            <div className="flex items-baseline justify-between">
              <span className="font-medium">Total</span>
              <span className="text-xl font-semibold numeric">
                {formatCurrency(totals.totalAmount)}
              </span>
            </div>

            <Separator />

            {canDiscount ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Discount ₹">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={discountAmount}
                    onChange={(event) =>
                      setDiscountAmount(Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </FormField>
                <FormField label="GST %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={gstRate}
                    onChange={(event) => setGstRate(Number(event.target.value) || 0)}
                  />
                </FormField>
                <FormField label="Discount reason" className="sm:col-span-2">
                  <Input
                    value={discountReason}
                    onChange={(event) => setDiscountReason(event.target.value)}
                    placeholder="Loyalty, festive offer…"
                  />
                </FormField>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Advance ₹" error={fieldErrors.advanceAmount}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={advanceAmount}
                  onChange={(event) =>
                    setAdvanceAmount(Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </FormField>
              <FormField label="Method">
                <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="ONLINE">Online</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Balance due</span>
              <span className="font-semibold numeric">
                {formatCurrency(Math.max(0, totals.totalAmount - advanceAmount))}
              </span>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={isPending}
              onClick={() => setAfter("view")}
            >
              Save & view order
            </Button>
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={() => setAfter("again")}
            >
              <Plus /> Save & add another
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {totalPieces} garment {totalPieces === 1 ? "tag" : "tags"} will be generated
            </p>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
