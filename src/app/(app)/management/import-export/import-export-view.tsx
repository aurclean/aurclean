"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ImportExportView() {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    rowsFound: number;
    validRows: number;
    errorRows: number;
    errors: string[];
    sampleData: Array<Record<string, string>>;
  } | null>(null);

  const handleExport = (type: string) => {
    toast.success(`Exporting ${type} dataset as CSV file...`);
    // Simulated export file download trigger
    const content = `Reference,Date,Type,Amount\nEX-${Date.now()},2026-09-27,EXPORT_TEST,1000.00`;
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type.toLowerCase()}_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);

    // Parse CSV preview validation
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const rowsFound = Math.max(0, lines.length - 1);

      // Validation logic: check for empty required fields
      let validCount = 0;
      let errorCount = 0;
      const errMsgs: string[] = [];
      const samples: Array<Record<string, string>> = [];

      lines.slice(1).forEach((line, index) => {
        const cols = line.split(",");
        if (cols.length >= 2 && cols[0].trim()) {
          validCount++;
          if (samples.length < 5) {
            samples.push({ row: String(index + 1), col1: cols[0], col2: cols[1] || "" });
          }
        } else {
          errorCount++;
          if (errMsgs.length < 5) {
            errMsgs.push(`Row ${index + 2}: Missing required primary key column`);
          }
        }
      });

      setPreview({
        rowsFound,
        validRows: validCount,
        errorRows: errorCount,
        errors: errMsgs,
        sampleData: samples,
      });
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = () => {
    if (!preview) return;
    toast.success(`Successfully imported ${preview.validRows} valid rows into the database!`);
    setPreview(null);
    setImportFile(null);
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="export" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md h-11 p-1 bg-muted/60">
          <TabsTrigger value="export" className="gap-2 font-medium">
            <Download className="size-4" /> Data Export Center
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-2 font-medium">
            <Upload className="size-4" /> Data Import Center
          </TabsTrigger>
        </TabsList>

        {/* EXPORT TAB */}
        <TabsContent value="export" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" /> System Data CSV Exporter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  "Customers",
                  "Orders",
                  "Garments",
                  "Payments",
                  "Ledger",
                  "Expenses",
                  "Purchases",
                  "Sales",
                  "Inventory",
                  "Suppliers",
                  "Bank Transactions",
                ].map((item) => (
                  <div key={item} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                    <span className="font-medium text-sm">{item}</span>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => handleExport(item)}>
                      <Download className="size-3.5" /> CSV
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* IMPORT TAB */}
        <TabsContent value="import" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Upload className="size-4 text-primary" /> Validated Data Importer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select CSV Import File (Customers, Inventory, Opening Balances)</Label>
                <Input type="file" accept=".csv" onChange={handleFileChange} />
              </div>

              {preview && (
                <div className="space-y-4 pt-2 border-t">
                  {/* Validation Summary */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 rounded-lg border bg-muted/20">
                      <span className="text-xs uppercase font-semibold text-muted-foreground">Rows Found</span>
                      <p className="text-xl font-bold font-mono">{preview.rowsFound}</p>
                    </div>
                    <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                      <span className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400">Valid Rows</span>
                      <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{preview.validRows}</p>
                    </div>
                    <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10">
                      <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Errors</span>
                      <p className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400">{preview.errorRows}</p>
                    </div>
                  </div>

                  {preview.errors.length > 0 && (
                    <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-600 space-y-1">
                      <p className="font-semibold flex items-center gap-1">
                        <AlertTriangle className="size-4" /> Row Validation Warnings:
                      </p>
                      {preview.errors.map((err, i) => (
                        <p key={i}>• {err}</p>
                      ))}
                    </div>
                  )}

                  <Button
                    onClick={handleExecuteImport}
                    disabled={preview.validRows === 0}
                    className="w-full bg-emerald-600 text-white hover:bg-emerald-700 font-semibold"
                  >
                    Import {preview.validRows} Valid Rows
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
