"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({
  label = "Print",
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  return (
    <Button variant={variant} onClick={() => window.print()} className="no-print">
      <Printer /> {label}
    </Button>
  );
}
