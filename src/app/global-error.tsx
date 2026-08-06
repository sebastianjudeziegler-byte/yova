"use client";

import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";

import { useEffect } from "react";

import { SystemStateScreen } from "@/components/system-state-screen";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("YOVA root render failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <SystemStateScreen
          eyebrow="YOVA could not finish loading"
          title="Let’s get you back in."
          description="The application hit an unexpected problem while starting. Try again now, or reopen YOVA from its home page."
          documentTitle="YOVA · Unable to load"
          retry={retry}
          reference={error.digest}
        />
      </body>
    </html>
  );
}
