"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Root Error Caught]:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100 font-sans">
        <div className="max-w-md w-full text-center space-y-4 bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-2xl">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-semibold text-slate-100">Application Error</h1>
          <p className="text-sm text-slate-400">
            An unexpected error occurred on the server while loading the application.
          </p>
          {error?.message ? (
            <div className="p-3 bg-red-950/40 border border-red-900/50 rounded text-xs text-red-300 font-mono text-left overflow-auto max-h-32">
              {error.message}
            </div>
          ) : null}
          {error?.digest ? (
            <p className="font-mono text-xs text-slate-500">Digest: {error.digest}</p>
          ) : null}
          <button
            onClick={() => reset()}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
