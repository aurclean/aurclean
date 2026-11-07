import "server-only";
import crypto from "node:crypto";

import type { PaymentMethod } from "@/generated/prisma/enums";

export interface PaymentIntent {
  providerOrderId: string;
  amount: number;
  currency: string;
  /** Extra data the client needs to complete the payment (keys, UPI URIs …). */
  clientPayload: Record<string, string | number>;
}

export interface PaymentVerification {
  verified: boolean;
  providerPaymentId?: string;
  reason?: string;
}

export interface RefundOutcome {
  providerRefundId: string;
  status: "PROCESSED" | "PENDING" | "FAILED";
}

export interface PaymentGateway {
  readonly id: string;
  readonly supportedMethods: PaymentMethod[];
  /** True when money moves outside the app and must be confirmed by webhook. */
  readonly isOnline: boolean;
  createIntent(input: {
    amount: number;
    currency?: string;
    reference: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
  }): Promise<PaymentIntent>;
  verify(input: Record<string, string>): Promise<PaymentVerification>;
  refund(input: {
    providerPaymentId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundOutcome>;
}

/**
 * Counter payments: cash, UPI collected on a static QR, card machine.
 * The money is confirmed by the staff member, so there is nothing to call out to.
 */
class ManualGateway implements PaymentGateway {
  readonly id = "manual";
  readonly supportedMethods: PaymentMethod[] = [
    "CASH",
    "UPI",
    "CARD",
    "BANK_TRANSFER",
    "CREDIT",
  ];
  readonly isOnline = false;

  async createIntent(input: {
    amount: number;
    currency?: string;
    reference: string;
  }): Promise<PaymentIntent> {
    return {
      providerOrderId: `manual_${input.reference}`,
      amount: input.amount,
      currency: input.currency ?? "INR",
      clientPayload: { mode: "counter" },
    };
  }

  async verify(): Promise<PaymentVerification> {
    return { verified: true };
  }

  async refund(input: { providerPaymentId: string }): Promise<RefundOutcome> {
    return {
      providerRefundId: `manual_refund_${input.providerPaymentId}`,
      status: "PROCESSED",
    };
  }
}

/**
 * Razorpay Orders API. Credentials stay server-side; only the key id and the
 * order id ever reach the browser.
 */
class RazorpayGateway implements PaymentGateway {
  readonly id = "razorpay";
  readonly supportedMethods: PaymentMethod[] = ["UPI", "CARD", "ONLINE"];
  readonly isOnline = true;

  private get keyId() {
    const value = process.env.RAZORPAY_KEY_ID;
    if (!value) throw new Error("RAZORPAY_KEY_ID is not configured");
    return value;
  }

  private get keySecret() {
    const value = process.env.RAZORPAY_KEY_SECRET;
    if (!value) throw new Error("RAZORPAY_KEY_SECRET is not configured");
    return value;
  }

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  async createIntent(input: {
    amount: number;
    currency?: string;
    reference: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
  }): Promise<PaymentIntent> {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(input.amount * 100),
        currency: input.currency ?? "INR",
        receipt: input.reference,
        notes: {
          customerName: input.customerName ?? "",
          customerPhone: input.customerPhone ?? "",
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Razorpay order creation failed: ${response.status} ${body}`);
    }

    const order = (await response.json()) as { id: string; amount: number; currency: string };

    return {
      providerOrderId: order.id,
      amount: order.amount / 100,
      currency: order.currency,
      clientPayload: {
        key: this.keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    };
  }

  async verify(input: Record<string, string>): Promise<PaymentVerification> {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = input;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return { verified: false, reason: "Missing verification parameters" };
    }

    const expected = crypto
      .createHmac("sha256", this.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const provided = Buffer.from(razorpay_signature, "utf8");
    const computed = Buffer.from(expected, "utf8");
    const verified =
      provided.length === computed.length &&
      crypto.timingSafeEqual(provided, computed);

    return verified
      ? { verified: true, providerPaymentId: razorpay_payment_id }
      : { verified: false, reason: "Signature mismatch" };
  }

  async refund(input: {
    providerPaymentId: string;
    amount: number;
    reason?: string;
  }): Promise<RefundOutcome> {
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${input.providerPaymentId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Math.round(input.amount * 100),
          notes: { reason: input.reason ?? "" },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Razorpay refund failed: ${response.status} ${body}`);
    }

    const refund = (await response.json()) as { id: string; status: string };
    return {
      providerRefundId: refund.id,
      status: refund.status === "processed" ? "PROCESSED" : "PENDING",
    };
  }
}

/** Verifies a Razorpay webhook body against the shared webhook secret. */
export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(signature, "utf8");
  const computed = Buffer.from(expected, "utf8");
  return (
    provided.length === computed.length && crypto.timingSafeEqual(provided, computed)
  );
}

const gateways = new Map<string, PaymentGateway>();

export function getPaymentGateway(id?: string): PaymentGateway {
  const key = (id ?? process.env.PAYMENT_PROVIDER ?? "manual").toLowerCase();
  const existing = gateways.get(key);
  if (existing) return existing;

  const gateway: PaymentGateway =
    key === "razorpay" ? new RazorpayGateway() : new ManualGateway();
  gateways.set(key, gateway);
  return gateway;
}

/** Builds a UPI intent URI so a counter can show a dynamic QR for the exact amount. */
export function buildUpiIntentUri(input: {
  amount: number;
  reference: string;
  note?: string;
}): string | null {
  const vpa = process.env.UPI_VPA;
  const payeeName = process.env.UPI_PAYEE_NAME ?? process.env.APP_NAME ?? "Laundry";
  if (!vpa) return null;

  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: input.amount.toFixed(2),
    cu: "INR",
    tr: input.reference,
    tn: input.note ?? `Payment for ${input.reference}`,
  });

  return `upi://pay?${params.toString()}`;
}
