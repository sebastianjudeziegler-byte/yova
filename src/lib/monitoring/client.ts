"use client";

import type { ErrorSurface } from "@/lib/monitoring/schema";

type ProductErrorSignal = {
  surface: ErrorSurface;
  errorCode: string;
  digest?: string | null;
  requestId?: string | null;
};

const recentReports = new Set<string>();

export function reportProductError(signal: ProductErrorSignal) {
  if (typeof window === "undefined") return;

  const routePath = window.location.pathname;
  const reportKey = [signal.surface, signal.errorCode, signal.digest, signal.requestId, routePath].join(":");
  if (recentReports.has(reportKey)) return;
  recentReports.add(reportKey);
  window.setTimeout(() => recentReports.delete(reportKey), 30_000);

  void fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      surface: signal.surface,
      errorCode: signal.errorCode,
      digest: signal.digest ?? null,
      requestId: signal.requestId ?? null,
      routePath,
    }),
    keepalive: true,
  }).catch(() => undefined);
}
