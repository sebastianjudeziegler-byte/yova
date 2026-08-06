"use client";

import { useEffect } from "react";

import { SystemStateScreen } from "@/components/system-state-screen";
import { reportProductError } from "@/lib/monitoring/client";

export default function ErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportProductError({
      surface: "route_boundary",
      errorCode: "route_render_failed",
      digest: error.digest,
    });
    if (process.env.NODE_ENV !== "production") console.error("YOVA route render failed", error);
  }, [error]);

  return (
    <SystemStateScreen
      eyebrow="Something interrupted this view"
      title="YOVA needs a moment."
      description="An unexpected problem stopped this page from opening. Try it again first, or return home and continue from your saved learning work."
      documentTitle="YOVA · Something went wrong"
      retry={retry}
      reference={error.digest}
    />
  );
}
