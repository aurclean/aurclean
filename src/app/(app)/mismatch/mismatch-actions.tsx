"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRightLeft,
  Check,
  ExternalLink,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { signalDataChange } from "@/components/shared/live-refresh";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  correctOrderAction,
  dismissMismatchAction,
  reportMissingAction,
  rescanGarmentAction,
} from "./actions";

interface Props {
  garmentId: string;
  garmentCode: string;
  orderId: string;
  orderNumber: string;
  canResolve: boolean;
  canReassign: boolean;
  isMissing: boolean;
}

/**
 * The row of things an operator can do about one mismatch, in the order they
 * would try them: confirm it with a scan, put it back, fix the paperwork, or
 * admit it is gone.
 */
export function MismatchActions({
  garmentId,
  garmentCode,
  orderId,
  orderNumber,
  canResolve,
  canReassign,
  isMissing,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [correctOpen, setCorrectOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [targetOrder, setTargetOrder] = useState("");
  const [detail, setDetail] = useState("");

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        after?.();
        signalDataChange();
        router.refresh();
      } else {
        toast.error(result.error ?? "That did not work");
      }
    });

  return (
    <div className="flex flex-wrap gap-2">
      {!isMissing ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => rescanGarmentAction({ garmentId }),
              `${garmentCode} confirmed by scan`,
            )
          }
        >
          <ScanLine /> Scan again
        </Button>
      ) : null}

      {canReassign ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setCorrectOpen(true)}
        >
          <ArrowRightLeft /> Correct order
        </Button>
      ) : null}

      {canResolve && !isMissing ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setMissingOpen(true)}
        >
          <TriangleAlert /> Report missing
        </Button>
      ) : null}

      {canResolve ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(
              () => dismissMismatchAction({ garmentId }),
              `${garmentCode} cleared`,
            )
          }
        >
          <Check /> No action needed
        </Button>
      ) : null}

      <Button size="sm" variant="ghost" asChild>
        <Link href={`/orders/${orderId}`}>
          <ExternalLink /> View order
        </Link>
      </Button>

      <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {garmentCode} to another order</DialogTitle>
            <DialogDescription>
              It is currently on {orderNumber}. Its scans and history travel
              with it; both orders have their piece counts re-derived.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="correct-order">Order number</Label>
            <Input
              id="correct-order"
              value={targetOrder}
              onChange={(event) => setTargetOrder(event.target.value)}
              placeholder="ORD10042"
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCorrectOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || targetOrder.trim().length < 3}
              onClick={() =>
                run(
                  () =>
                    correctOrderAction({
                      garmentId,
                      orderNumber: targetOrder.trim(),
                    }),
                  `${garmentCode} reassigned`,
                  () => {
                    setCorrectOpen(false);
                    setTargetOrder("");
                  },
                )
              }
            >
              Reassign
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={missingOpen} onOpenChange={setMissingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report {garmentCode} missing</DialogTitle>
            <DialogDescription>
              This marks the piece lost on {orderNumber} and keeps it on the
              mismatch centre until someone finds it or closes the case.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="missing-detail">Where was it last seen?</Label>
            <Input
              id="missing-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="Not in the bundle at ironing"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMissingOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    reportMissingAction({
                      garmentId,
                      detail: detail || undefined,
                    }),
                  `${garmentCode} reported missing`,
                  () => {
                    setMissingOpen(false);
                    setDetail("");
                  },
                )
              }
            >
              Report missing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
