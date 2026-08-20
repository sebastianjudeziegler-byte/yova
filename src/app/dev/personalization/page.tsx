import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PersonalizationInspector } from "@/components/personalization-inspector";

/**
 * Development-only routing inspector.
 *
 * The gate is deliberately the environment rather than a feature flag or an
 * account check. A flag can be switched on by accident and an account check
 * still serves the page to anyone who reaches it; a production build has no
 * route here at all.
 */
export const metadata: Metadata = {
  title: "Personalization inspector",
  robots: { index: false, follow: false },
};

export default function PersonalizationInspectorPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <PersonalizationInspector />;
}
