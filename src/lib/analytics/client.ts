"use client";

import type { ProductEventRequest } from "@/lib/analytics/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function trackProductEvent(event: ProductEventRequest, enabled = true) {
  if (!enabled || !isSupabaseConfigured()) return;

  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // Analytics must never block or interrupt the learning experience.
  });
}
