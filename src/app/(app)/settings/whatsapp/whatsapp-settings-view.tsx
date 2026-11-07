"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Edit2,
  Globe,
  Loader2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/dates";
import type { OpenWaSessionStatus, WhatsAppStatusResponse } from "@/lib/services/whatsapp";
import type { WhatsAppMessageType } from "@/generated/prisma/client";

import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  reconnectWhatsAppAction,
  refreshWhatsAppAction,
  saveTemplateAction,
  sendWhatsAppAction,
} from "./actions";

interface Props {
  firmName: string;
  initialStatusData: WhatsAppStatusResponse;
  templates: Array<{
    id: string;
    code: WhatsAppMessageType;
    name: string;
    body: string;
    isActive: boolean;
  }>;
}

const STATUS_CONFIG: Record<
  OpenWaSessionStatus,
  { label: string; badgeTone: "success" | "danger" | "warning" | "info" | "neutral"; icon: any; desc: string }
> = {
  ready: {
    label: "Ready & Connected",
    badgeTone: "success",
    icon: CheckCircle2,
    desc: "WhatsApp session is authenticated and ready to dispatch messages.",
  },
  qr_ready: {
    label: "Scan QR Code",
    badgeTone: "warning",
    icon: QrCode,
    desc: "QR code generated. Scan with WhatsApp on your mobile device.",
  },
  authenticating: {
    label: "Authenticating...",
    badgeTone: "info",
    icon: Loader2,
    desc: "WhatsApp Web handshake in progress...",
  },
  initializing: {
    label: "Initializing...",
    badgeTone: "info",
    icon: Loader2,
    desc: "Starting OpenWA session...",
  },
  action_required: {
    label: "Action Required",
    badgeTone: "warning",
    icon: AlertTriangle,
    desc: "Manual action required on OpenWA session.",
  },
  not_configured: {
    label: "Not Connected",
    badgeTone: "neutral",
    icon: WifiOff,
    desc: "This firm has no WhatsApp account linked yet. Click Connect WhatsApp to get a QR code.",
  },
  stopped: {
    label: "Disconnected",
    badgeTone: "neutral",
    icon: WifiOff,
    desc: "This firm's WhatsApp session is not running. Reconnect to resume.",
  },
  disconnected: {
    label: "Disconnected",
    badgeTone: "neutral",
    icon: WifiOff,
    desc: "No active WhatsApp session.",
  },
  failed: {
    label: "Session Failed",
    badgeTone: "danger",
    icon: XCircle,
    desc: "OpenWA session connection failed.",
  },
  openwa_unavailable: {
    label: "OpenWA Unavailable",
    badgeTone: "danger",
    icon: AlertCircle,
    desc: "Unable to connect to OpenWA service.",
  },
  erp_unavailable: {
    label: "ERP Database Error",
    badgeTone: "danger",
    icon: AlertCircle,
    desc: "ERP database connection failure.",
  },
};

export function WhatsAppSettingsView({ firmName, initialStatusData, templates: initialTemplates }: Props) {
  const [statusData, setStatusData] = useState<WhatsAppStatusResponse>(initialStatusData);
  const [templates, setTemplates] = useState(initialTemplates);
  const [editingTemplate, setEditingTemplate] = useState<{ code: WhatsAppMessageType; name: string; body: string } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [testConnResult, setTestConnResult] = useState<{ erp: boolean; openWa: boolean; session: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cfg = STATUS_CONFIG[statusData.status] || STATUS_CONFIG.disconnected;

  // Real-time status polling for non-terminal states (2.5 second interval)
  useEffect(() => {
    const activeStates: OpenWaSessionStatus[] = ["initializing", "qr_ready", "authenticating"];
    const shouldPoll = activeStates.includes(statusData.status);
    setIsPolling(shouldPoll);

    if (!shouldPoll) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/whatsapp/status?refresh=true");
        if (res.ok) {
          const json: WhatsAppStatusResponse = await res.json();
          if (json && json.success) {
            setStatusData(json);
            if (json.status === "ready") {
              toast.success(`WhatsApp Connected! Linked to ${json.phoneNumber || "number unavailable"}`);
            }
          }
        }
      } catch (err) {
        console.warn("Status poll error:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [statusData.status]);

  const handleConnect = () => {
    startTransition(async () => {
      const res = await connectWhatsAppAction();
      if (res.ok && res.data) {
        setStatusData(res.data);
        if (!res.data.openWaOk) {
          toast.error(res.data.error || "Unable to reach OpenWA service.");
        } else {
          toast.success("OpenWA session connection started!");
        }
      } else {
        toast.error(res.error || "Failed to connect WhatsApp session");
      }
    });
  };

  const handleRefresh = () => {
    startTransition(async () => {
      const res = await refreshWhatsAppAction();
      if (res.ok && res.data) {
        setStatusData(res.data);
        toast.success("WhatsApp status refreshed!");
      } else {
        toast.error(res.error || "Failed to refresh WhatsApp status");
      }
    });
  };

  const handleReconnect = () => {
    startTransition(async () => {
      const res = await reconnectWhatsAppAction();
      if (res.ok && res.data) {
        setStatusData(res.data);
        toast.success("Session restarted! Refreshing status...");
      } else {
        toast.error(res.error || "Failed to reconnect WhatsApp session");
      }
    });
  };

  const handleDisconnect = () => {
    startTransition(async () => {
      const res = await disconnectWhatsAppAction();
      if (res.ok && res.data) {
        setStatusData(res.data);
        toast.success("WhatsApp session disconnected.");
      } else {
        toast.error(res.error || "Failed to disconnect session");
      }
    });
  };

  const handleTestConnection = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/whatsapp/status?refresh=true");
        if (res.ok) {
          const json: WhatsAppStatusResponse = await res.json();
          setStatusData(json);
          setTestConnResult({
            erp: json.erpOk,
            openWa: json.openWaOk,
            session: json.status,
          });

          if (json.erpOk && json.openWaOk && json.connected) {
            toast.success("All systems connected! Ready for WhatsApp messaging.");
          } else if (json.erpOk && json.openWaOk) {
            toast.info(`ERP & OpenWA connected. Session status: ${json.status}`);
          } else if (!json.openWaOk) {
            toast.error("OpenWA service is disconnected or unreachable.");
          } else {
            toast.error("ERP database failure.");
          }
        } else {
          toast.error("Test connection request failed.");
        }
      } catch (err: any) {
        toast.error(err?.message || "Test connection failed.");
      }
    });
  };

  const handleSaveTemplate = () => {
    if (!editingTemplate) return;
    startTransition(async () => {
      const res = await saveTemplateAction(editingTemplate.code, editingTemplate.name, editingTemplate.body);
      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) => (t.code === editingTemplate.code ? { ...t, body: editingTemplate.body } : t)),
        );
        toast.success(`Template ${editingTemplate.name} saved!`);
        setEditingTemplate(null);
      } else {
        toast.error(res.error || "Failed to save template");
      }
    });
  };

  const handleTestMessage = () => {
    if (!testPhone.trim()) {
      toast.error("Please enter a phone number for test delivery.");
      return;
    }
    startTransition(async () => {
      const res = await sendWhatsAppAction({
        phone: testPhone,
        messageType: "CUSTOM",
        messageText: "Test message from AURCLEAN Laundry ERP. Connection verified successfully!",
      });

      if (res.ok && res.data?.success) {
        toast.success(`Test WhatsApp message sent to ${testPhone}! (ID: ${res.data.messageId})`);
      } else {
        toast.error(res.error || "Message delivery failed via OpenWA.");
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Gateway Settings"
        description="Manage real OpenWA session connection, health diagnostics, and automated ERP message templates."
      />
      <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current firm</p>
        <p className="text-sm font-bold">{firmName}</p>
        <p className="text-xs text-muted-foreground">This WhatsApp login belongs to this firm only. Other firms connect their own accounts.</p>
      </div>

      {/* Real-time Status Panel Header */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between border-b bg-muted/20">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Globe className="size-4 text-emerald-600 dark:text-emerald-400" />
              AURCLEAN WhatsApp Real-Time Integration
            </CardTitle>

          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleTestConnection}
              disabled={pending}
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
            >
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Test Connection
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={pending}
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Refresh Status
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-3 rounded-xl border bg-card space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                Provider
              </p>
              <p className="text-base font-bold">OpenWA</p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">{statusData.openWaUrl}</p>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                ERP Backend
                <Database className="size-3.5 text-muted-foreground" />
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <span className={`size-2.5 rounded-full ${statusData.erpOk ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span className="text-sm font-bold">{statusData.erpOk ? "Connected" : "Disconnected"}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">PostgreSQL Database</p>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                OpenWA API
                <Globe className="size-3.5 text-muted-foreground" />
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <span className={`size-2.5 rounded-full ${statusData.openWaOk ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span className="text-sm font-bold">{statusData.openWaOk ? "Connected" : "Disconnected"}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">REST API Server</p>
            </div>

            <div className="p-3 rounded-xl border bg-card space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                WhatsApp Session
                <cfg.icon className="size-3.5 text-muted-foreground" />
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <Badge tone={cfg.badgeTone} className="text-xs">
                  {cfg.label}
                </Badge>
                {isPolling && <Loader2 className="size-3 animate-spin text-emerald-500" />}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Session ID: <code className="font-mono">{statusData.sessionId || "—"}</code>
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/20">
              <Smartphone className="size-5 text-cyan-500 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground font-medium">WhatsApp Account / Number</p>
                <p className="text-sm font-bold font-mono">
                  {statusData.connected
                    ? statusData.phoneNumber || "Number unavailable"
                    : "Number unavailable"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/20">
              <ShieldCheck className="size-5 text-emerald-500 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground font-medium">Security & Proxy Status</p>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Server-side API key protection active · Last checked: {formatDateTime(statusData.lastCheckedAt)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection Test Diagnostics Result Box */}
      {testConnResult && (
        <Card className="border-emerald-500/30 bg-emerald-950/5 dark:bg-emerald-950/20">
          <CardContent className="pt-4 text-xs space-y-2">
            <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" /> Test Connection Diagnostics Summary
            </h4>
            <div className="grid grid-cols-3 gap-2 font-mono">
              <div className="p-2 border rounded bg-card">
                ERP Backend: <span className={testConnResult.erp ? "text-emerald-600 font-bold" : "text-rose-500 font-bold"}>{testConnResult.erp ? "Connected" : "Disconnected"}</span>
              </div>
              <div className="p-2 border rounded bg-card">
                OpenWA REST API: <span className={testConnResult.openWa ? "text-emerald-600 font-bold" : "text-rose-500 font-bold"}>{testConnResult.openWa ? "Connected" : "Disconnected"}</span>
              </div>
              <div className="p-2 border rounded bg-card">
                Session State: <span className="font-bold text-primary">{testConnResult.session}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real Error Banners */}
      {statusData.status === "openwa_unavailable" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-100">
          <AlertCircle className="size-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-bold text-sm">Unable to Connect to WhatsApp Service (OpenWA Offline)</h4>
            <p className="leading-relaxed">
              OpenWA API at <code className="font-mono px-1 py-0.5 bg-rose-950/20 rounded">{statusData.openWaUrl}</code> is unreachable.
              Ensure the OpenWA process or container is running and that your API key is correctly configured.
            </p>
            {statusData.error && (
              <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300 pt-1">
                Details: {statusData.error}
              </p>
            )}
          </div>
        </div>
      )}

      {statusData.status === "erp_unavailable" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-100">
          <AlertCircle className="size-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-bold text-sm">ERP Database Failure</h4>
            <p className="leading-relaxed">
              Unable to reach PostgreSQL database. Check database server connectivity.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="connection" className="space-y-6">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="connection" className="gap-2">
            <Wifi className="size-4" /> Session Management
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <MessageSquare className="size-4" /> Message Templates
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-2">
            <Send className="size-4" /> Test Delivery
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connection">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">
                  OpenWA Gateway Session Control
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Start, monitor, or terminate your real WhatsApp Web session.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    Current Status:{" "}
                    <Badge tone={cfg.badgeTone}>
                      {cfg.label}
                    </Badge>
                    {isPolling && (
                      <span className="flex items-center gap-1 text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
                        <Loader2 className="size-3 animate-spin" /> Auto-polling every 2.5s
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {cfg.desc}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!statusData.connected ? (
                    <Button
                      onClick={handleConnect}
                      disabled={pending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-sm"
                    >
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                      Connect WhatsApp
                    </Button>
                  ) : (
                    <Button
                      onClick={handleDisconnect}
                      disabled={pending}
                      variant="destructive"
                      className="gap-2"
                    >
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <WifiOff className="size-4" />}
                      Disconnect
                    </Button>
                  )}

                  <Button
                    onClick={handleReconnect}
                    disabled={pending}
                    variant="outline"
                    className="gap-2 text-xs"
                    title="Force restart session on OpenWA"
                  >
                    <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Reconnect
                  </Button>
                </div>
              </div>

              {/* REAL QR Code Display Section */}
              {statusData.status === "qr_ready" && (
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-emerald-500/40 rounded-2xl bg-card space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                    <QrCode className="size-5" />
                    <span>Scan QR Code with WhatsApp</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    Open WhatsApp on your mobile device → Settings → Linked Devices → Link a Device, then scan this QR code.
                  </p>

                  {statusData.qrCode ? (
                    <div className="p-4 bg-white rounded-2xl shadow-xl border border-slate-200">
                      <img
                        src={statusData.qrCode}
                        alt="WhatsApp Web QR Code"
                        className="size-56 object-contain"
                      />
                    </div>
                  ) : (
                    <div className="p-6 border rounded-xl bg-amber-500/10 text-amber-900 dark:text-amber-200 text-center space-y-1">
                      <p className="font-bold text-xs">Unable to generate WhatsApp QR code</p>
                      <p className="text-[11px] text-muted-foreground">
                        {statusData.error || "Waiting for OpenWA API to issue QR code payload..."}
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin text-emerald-500" />
                    Polling OpenWA session status every 2.5 seconds...
                  </p>
                </div>
              )}

              {statusData.connected && (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <CheckCircle2 className="size-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-emerald-950 dark:text-emerald-100">
                        WhatsApp Session Active & Connected
                      </h4>
                      <p className="text-xs text-emerald-800 dark:text-emerald-300">
                        Account: <span className="font-mono font-bold">{statusData.phoneNumber || "Number unavailable"}</span>
                      </p>
                    </div>
                  </div>
                  <Badge tone="success" className="text-xs">READY</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <div className="space-y-4">
            <h3 className="text-base font-semibold">ERP Automated WhatsApp Message Templates</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {templates.map((tpl) => (
                <Card key={tpl.id} className="border-border/60">
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold">{tpl.name}</CardTitle>
                      <span className="text-[10px] font-mono text-muted-foreground">{tpl.code}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() => setEditingTemplate({ code: tpl.code, name: tpl.name, body: tpl.body })}
                    >
                      <Edit2 className="size-3" /> Edit
                    </Button>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-sans leading-relaxed">
                      {tpl.body}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="test">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Send Test WhatsApp Message</CardTitle>
              <p className="text-xs text-muted-foreground">
                Dispatch a real test message through OpenWA API.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Recipient Phone Number</Label>
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="Enter phone number with country code"
                />
              </div>
              <Button
                onClick={handleTestMessage}
                disabled={pending || !statusData.connected}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send Test WhatsApp
              </Button>

              {!statusData.connected && (
                <p className="text-[11px] text-rose-500 font-medium text-center">
                  WhatsApp must be connected (`status = "ready"`) to send test messages.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Template Editing Dialog */}
      {editingTemplate && (
        <Dialog open={Boolean(editingTemplate)} onOpenChange={() => setEditingTemplate(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">Edit {editingTemplate.name} Template</DialogTitle>
              <DialogDescription className="text-xs">
                Use placeholders: {"{{customerName}}"}, {"{{orderId}}"}, {"{{invoiceNumber}}"}, {"{{total}}"}, {"{{paid}}"}, {"{{balance}}"}, {"{{deliveryDate}}"}, {"{{businessName}}"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Template Body</Label>
                <Textarea
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                  className="h-44 text-xs font-sans leading-relaxed"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveTemplate}
                disabled={pending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Template
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
