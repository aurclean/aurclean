"use client";

import { useState } from "react";
import { FileText, Save, Building2, Sliders, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { saveCompanyDocumentSettingsAction } from "@/app/api/documents/actions";
import type { CompanyProfile } from "@/lib/pdf/types";

interface Props {
  initialSettings: CompanyProfile;
}

export function DocumentSettingsView({ initialSettings }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CompanyProfile>(initialSettings);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await saveCompanyDocumentSettingsAction(form);
      if (res.success) {
        toast.success("Document and Branding Settings saved successfully!");
      } else {
        toast.error("Failed to save settings");
      }
    } catch (err: any) {
      toast.error(err?.message || "Settings save error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <FileText className="size-6 text-primary" /> Document & PDF Settings
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure company branding, address, document prefixes, and terms used across all generated PDF documents.
          </p>
        </div>
        <Button type="submit" disabled={loading} loading={loading} className="gap-2">
          <Save className="size-4" /> {loading ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {/* Company Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-primary" /> Company Profile & Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold">Company Business Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="AURCLEAN Laundry Management"
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">GSTIN / Tax ID</Label>
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                placeholder="29AAAAA0000A1Z5"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Official Business Address</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Clean Tech Park, Indiranagar, Bengaluru, KA 560038"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold">Phone Number</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 9876543210"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Email Address</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="support@aurclean.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Website</Label>
              <Input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="www.aurclean.com"
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Document Prefixes Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="size-4 text-primary" /> Document Numbering Prefixes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs font-semibold">Invoice Prefix</Label>
            <Input
              value={form.invoicePrefix || "INV"}
              onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
              placeholder="INV"
              className="mt-1 font-mono font-bold"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold">Delivery Challan Prefix</Label>
            <Input
              value={form.challanPrefix || "DC"}
              onChange={(e) => setForm({ ...form, challanPrefix: e.target.value })}
              placeholder="DC"
              className="mt-1 font-mono font-bold"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold">Payment Receipt Prefix</Label>
            <Input
              value={form.receiptPrefix || "REC"}
              onChange={(e) => setForm({ ...form, receiptPrefix: e.target.value })}
              placeholder="REC"
              className="mt-1 font-mono font-bold"
            />
          </div>
        </CardContent>
      </Card>

      {/* Terms & Footer Text Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" /> Standard Terms & Footer Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Footer Text (Appears on all PDF pages)</Label>
            <Input
              value={form.footerText}
              onChange={(e) => setForm({ ...form, footerText: e.target.value })}
              placeholder="Thank you for choosing AURCLEAN."
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Standard Terms & Conditions</Label>
            <Textarea
              value={form.termsConditions}
              onChange={(e) => setForm({ ...form, termsConditions: e.target.value })}
              rows={4}
              placeholder="1. Goods once delivered cannot be returned..."
              className="mt-1 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading} loading={loading} size="lg" className="gap-2">
          <Save className="w-4 h-4" /> {loading ? "Saving Settings..." : "Save Settings"}
        </Button>
      </div>
    </form>
  );
}
