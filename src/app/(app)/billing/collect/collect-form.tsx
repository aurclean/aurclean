"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, QrCode as QrIcon } from "lucide-react";
import { toast } from "sonner";

import { signalDataChange } from "@/components/shared/live-refresh";

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
import { FormField } from "@/components/shared/form-field";
import { QrCode } from "@/components/shared/code-image";
import { formatCurrency } from "@/lib/money";
import {
  createPaymentIntentAction,
  recordPaymentAction,
} from "@/app/(app)/billing/actions";

interface CollectFormProps {
  orderId: string;
  orderNumber: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
}

export function CollectForm({
  orderId,
  orderNumber,
  customerName,
  totalAmount,
  paidAmount,
  outstanding,
}: CollectFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [upiUri, setUpiUri] = useState<string | null>(null);

  const record = () => {
    startTransition(async () => {
      const result = await recordPaymentAction({
        orderId,
        amount,
        method,
        reference,
        notes,
      });

      if (result.ok) {
        toast.success(
          `${result.data.paymentNumber} recorded — ${formatCurrency(result.data.outstanding)} still outstanding`,
        );
        router.push(`/orders/${orderId}`);
        signalDataChange();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const showUpiQr = () => {
    startTransition(async () => {
      const result = await createPaymentIntentAction({ orderId, amount });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.upiUri) {
        setUpiUri(result.data.upiUri);
      } else {
        toast.error("No UPI VPA is configured for this business");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Collect payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Amount ₹"
              required
              hint={`Outstanding ${formatCurrency(outstanding)}`}
            >
              <Input
                type="number"
                min={0}
                max={outstanding}
                step="0.01"
                value={amount}
                onChange={(event) =>
                  setAmount(Math.max(0, Number(event.target.value) || 0))
                }
                className="h-12 text-lg"
              />
            </FormField>

            <FormField label="Method" required>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
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

            <FormField
              label="Reference"
              hint="UPI transaction id, card auth code…"
            >
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </FormField>

            <FormField label="Notes">
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-2">
            {[0.25, 0.5, 1].map((fraction) => (
              <Button
                key={fraction}
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setAmount(Math.round(outstanding * fraction * 100) / 100)
                }
              >
                {fraction === 1 ? "Full balance" : `${fraction * 100}%`}
              </Button>
            ))}
            {method === "UPI" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={showUpiQr}
              >
                <QrIcon /> Show UPI QR
              </Button>
            ) : null}
          </div>

          {upiUri ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 p-4">
              <QrCode value={upiUri} size={180} />
              <p className="text-sm text-muted-foreground">
                Ask the customer to scan and pay {formatCurrency(amount)}, then
                record it below.
              </p>
            </div>
          ) : null}

          <Button
            size="xl"
            className="w-full"
            loading={isPending}
            disabled={amount <= 0}
            onClick={record}
          >
            <Banknote /> Record {formatCurrency(amount)}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{orderNumber}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{customerName}</p>
          <Separator />
          <dl className="space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Order total</dt>
              <dd className="numeric">{formatCurrency(totalAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Already paid</dt>
              <dd className="numeric text-success">
                {formatCurrency(paidAmount)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Outstanding</dt>
              <dd className="font-semibold numeric text-destructive">
                {formatCurrency(outstanding)}
              </dd>
            </div>
          </dl>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>After this payment</span>
            <span className="numeric">
              {formatCurrency(Math.max(0, outstanding - amount))}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
