import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function TrustPage({
  eyebrow,
  title,
  summary,
  children,
  updated = "August 16, 2026",
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  updated?: string;
}) {
  return (
    <main className="trust-shell">
      <header className="trust-header">
        <Link href="/" aria-label="Return to YOVA"><BrandMark /></Link>
        <Link className="button ghost" href="/"><ArrowLeft size={17} /> Back to YOVA</Link>
      </header>
      <article className="trust-document">
        <header>
          <span className="step-label">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{summary}</p>
          <small>Alpha version · Updated {updated}</small>
        </header>
        <div className="trust-content">{children}</div>
      </article>
      <nav className="trust-footer" aria-label="YOVA trust and support">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/support">Support</Link>
      </nav>
    </main>
  );
}
