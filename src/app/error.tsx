"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Root Error Caught]:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center font-sans">
      <div className="max-w-md w-full space-y-4 bg-card border rounded-xl p-8 shadow-lg">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive font-bold text-xl">
          !
        </div>
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          The server encountered an error while serving this page.
        </p>
        {error?.message ? (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive font-mono text-left overflow-auto max-h-32">
            {error.message}
          </div>
        ) : null}
        {error?.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Digest: {error.digest}</p>
        ) : null}
        <button
          onClick={() => reset()}
          className="w-full py-2 px-4 bg-primary text-primary-foreground font-medium rounded-md text-sm transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
