import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DashboardError } from "@/components/founder-dashboard";
import { FounderNav } from "@/components/founder-nav";
import styles from "@/components/founder-dashboard.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FounderLayout({ children }: { children: ReactNode }) {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return (
      <main className={styles.shell}>
        <DashboardError title="Founder dashboard unavailable" body="Connect YOVA to Supabase, then reload this private dashboard." />
      </main>
    );
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return (
      <main className={styles.shell}>
        <DashboardError title="Sign in first" body="Use your YOVA founder account, then reopen this dashboard." />
      </main>
    );
  }

  const { data: founderAccess, error: founderError } = await supabase.rpc("is_yova_founder");
  if (founderError || founderAccess !== true) {
    return (
      <main className={styles.shell}>
        <DashboardError title="Founder access required" body="This area is private to YOVA's founder account." />
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brandHome} href="/founder/overview" aria-label="YOVA founder overview">
          <BrandMark />
        </Link>
        <FounderNav />
        <Link className={styles.openYova} href="/">
          Open YOVA <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </header>
      <div className={styles.content}>{children}</div>
    </main>
  );
}
