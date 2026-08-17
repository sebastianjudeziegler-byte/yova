import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { FounderTesterAccess, type FounderTester } from "@/components/founder-tester-access";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TesterInviteRow = {
  email: string;
  display_name: string | null;
  status: string;
  invited_at: string;
  joined_at: string | null;
};

export default async function FounderTestersPage() {
  const passwordAccountsEnabled = process.env.AUTH_PASSWORD_ACCOUNTS === "true";
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return <FounderMessage title="Sign in first" body="Use your YOVA founder account, then reopen this page." />;
  }

  const { data: founderAccess, error: founderError } = await supabase.rpc("is_yova_founder");
  if (founderError || founderAccess !== true) {
    return <FounderMessage title="Founder access required" body="This tester invitation list is private to the YOVA founder account." />;
  }

  if (!isSupabaseAdminConfigured()) {
    return <FounderMessage title="Invitation service not configured" body="Add YOVA's server-only Supabase secret key before inviting testers." />;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tester_invites")
    .select("email,display_name,status,invited_at,joined_at")
    .order("invited_at", { ascending: false });

  if (error) {
    console.error("YOVA founder tester list failed", { code: error.code ?? "unknown" });
    return <FounderMessage title="Tester list unavailable" body="YOVA could not load tester access right now. Refresh in a moment." />;
  }

  const testers = ((data ?? []) as TesterInviteRow[]).map(founderTesterFromRow);

  return (
    <main className="founder-reliability-shell">
      <header>
        <BrandMark />
        <div>
          <span>FOUNDER VIEW</span>
          <h1>Tester access</h1>
          <p>Invite one person by email, then see who has joined the testing cohort. Only this founder view can access the invitation list.</p>
        </div>
        <Link href="/founder/reliability">Reliability</Link>
      </header>
      <FounderTesterAccess initialTesters={testers} passwordAccountsEnabled={passwordAccountsEnabled} />
    </main>
  );
}

function FounderMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="founder-reliability-shell centered">
      <BrandMark />
      <section>
        <h1>{title}</h1>
        <p>{body}</p>
        <Link href="/">Return to YOVA</Link>
      </section>
    </main>
  );
}

function founderTesterFromRow(row: TesterInviteRow): FounderTester {
  return {
    email: row.email,
    displayName: row.display_name,
    status: row.status === "joined" ? "joined" : "pending",
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
  };
}
