import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  if (process.env.AUTH_PASSWORD_ACCOUNTS !== "true" || !isSupabaseConfigured()) {
    redirect("/?auth=invalid-link");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) redirect("/?auth=invalid-link");

  const { source } = await searchParams;
  return <SetPasswordForm source={source === "invite" || source === "recovery" ? source : "account"} />;
}
