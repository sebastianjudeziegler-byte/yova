import { SystemStateScreen } from "@/components/system-state-screen";
import { YovaPrototype } from "@/components/yova-prototype";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const productionNeedsConfiguration = process.env.NODE_ENV === "production"
    && (!isSupabaseConfigured() || !isOpenAIPlanConfigured());
  const emailCodeVerificationEnabled = process.env.AUTH_EMAIL_CODE_VERIFICATION === "true";

  if (productionNeedsConfiguration) {
    return (
      <SystemStateScreen
        eyebrow="Private alpha setup"
        title="YOVA is finishing its connection."
        description="This environment is not ready to create durable accounts or personalized sessions yet. No learning work is being saved here. Please try again after setup is complete."
        documentTitle="YOVA · Setup in progress"
        reload
        showHomeAction={false}
        reference="production-configuration"
      />
    );
  }

  return <YovaPrototype emailCodeVerificationEnabled={emailCodeVerificationEnabled} />;
}
