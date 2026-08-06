"use client";

import { useEffect } from "react";

import { SystemStateScreen } from "@/components/system-state-screen";

export default function ErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("YOVA route render failed", error);
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
