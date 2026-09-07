"use client";

import { useState } from "react";
import { z } from "zod";
import { LearningContent } from "@/components/learning-content";

export type SavedLessonReviewIdentity = {
  planId: string;
  planSessionId: string;
  activityIndex: number;
  generatedAt: string;
  routeRevisionId?: string;
};
const ReviewSchema = z.object({ saved: z.boolean(), content: z.string().min(1).max(12_000), notice: z.string().optional() });

export function SavedLessonReview({ identity }: { identity: SavedLessonReviewIdentity }) {
  const [review, setReview] = useState<z.infer<typeof ReviewSchema> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        planId: identity.planId, planSessionId: identity.planSessionId,
        activityIndex: String(identity.activityIndex), generatedAt: identity.generatedAt,
        ...(identity.routeRevisionId ? { routeRevisionId: identity.routeRevisionId } : {}),
      });
      const response = await fetch(`/api/sessions/lesson?${query}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(body);
        throw new Error(failure.success ? failure.data.error : "YOVA could not load this explanation.");
      }
      setReview(ReviewSchema.parse(body));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "YOVA could not load this explanation.");
    } finally {
      setLoading(false);
    }
  };

  return <div className="saved-lesson-review">
    {review ? <>
      {review.notice && <p role="status">{review.notice}</p>}
      <LearningContent content={review.content} className="resource-activity-body" />
    </> : <>
      {error && <p role="alert">{error}</p>}
      <button className="button secondary" disabled={loading} onClick={() => void load()}>
        {loading ? "Opening explanation…" : error ? "Try loading explanation again" : "Read this explanation"}
      </button>
    </>}
  </div>;
}
