"use client";
import { useEffect, useState } from "react";
import { LearningContent } from "./learning-content";

export function ReviewedBlockExplanation({ planId, planSessionId, routeRevisionId, blockId, activityId, content }: {
  planId: string; planSessionId: string; routeRevisionId: string; blockId: string; activityId: string; content: string;
}) {
  const [delivery, setDelivery] = useState({ text: "", unavailable: false });
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/sessions/block/explanation", { method: "POST", signal: abort.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, planSessionId, routeRevisionId, blockId, activityId }) });
        if (!response.ok || !response.body) throw new Error("The saved stream is unavailable.");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = "";
        while (!abort.signal.aborted) {
          const result = await reader.read();
          if (result.done) { text += decoder.decode(); break; }
          text += decoder.decode(result.value, { stream: true });
          setDelivery({ text, unavailable: false });
        }
        if (!abort.signal.aborted) setDelivery({ text, unavailable: false });
      } catch { if (!abort.signal.aborted) setDelivery({ text: content, unavailable: true }); }
    })();
    return () => abort.abort();
  }, [planId, planSessionId, routeRevisionId, blockId, activityId, content]);
  return <>{delivery.unavailable && <p role="status">Showing your saved explanation. Your practice is unchanged.</p>}
    {delivery.text ? <LearningContent content={delivery.text} /> : <p role="status">Opening your saved explanation…</p>}</>;
}
