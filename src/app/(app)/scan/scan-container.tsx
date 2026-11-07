"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers, ScanLine, Sparkles, Activity } from "lucide-react";

import { ScanStation } from "./scan-station";
import { BatchScanner } from "./batch-scanner";
import type { ScanHistoryRow } from "@/lib/services/scanning";

interface Props {
  history: ScanHistoryRow[];
  canUpdateStatus: boolean;
  canResolve: boolean;
}

export function ScanContainer({ history, canUpdateStatus, canResolve }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const mode = searchParams.get("mode") === "batch" ? "batch" : "single";

  const handleTabChange = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val === "batch") {
      params.set("mode", "batch");
    } else {
      params.delete("mode");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Tabs value={mode} onValueChange={handleTabChange} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-card via-card to-muted/40 p-2 rounded-2xl border border-border/80 shadow-xs">
        <TabsList className="grid w-full sm:w-auto grid-cols-2 min-w-[340px] h-12 p-1.5 bg-muted/80 backdrop-blur-md rounded-xl">
          <TabsTrigger
            value="single"
            className="gap-2 font-semibold text-xs uppercase tracking-wider transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <ScanLine className="size-4 text-primary" />
            Workstation Scan
          </TabsTrigger>
          <TabsTrigger
            value="batch"
            className="gap-2 font-semibold text-xs uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
          >
            <Layers className="size-4" />
            Batch Mode
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2 px-3 text-xs text-muted-foreground self-end sm:self-auto">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono font-medium">Scanner Station Ready</span>
        </div>
      </div>

      <TabsContent value="single" className="space-y-5 focus-visible:outline-none">
        <ScanStation
          history={history}
          canUpdateStatus={canUpdateStatus}
          canResolve={canResolve}
        />
      </TabsContent>

      <TabsContent value="batch" className="space-y-5 focus-visible:outline-none">
        <BatchScanner />
      </TabsContent>
    </Tabs>
  );
}

