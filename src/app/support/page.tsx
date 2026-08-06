import type { Metadata } from "next";
import { SupportForm } from "@/components/support-form";
import { TrustPage } from "@/components/trust-page";

export const metadata: Metadata = {
  title: "Support · YOVA",
  description: "Private support and troubleshooting for YOVA alpha testers.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return <TrustPage eyebrow="YOVA SUPPORT" title="Help us see what you saw." summary="Signed-in private-alpha testers can send a problem or product suggestion directly to the YOVA support queue.">
    <section className="support-basics"><h2>Before sending</h2><div><article><strong>Sign-in email</strong><p>Use the newest email link, and open it in the browser where you requested it. The temporary email service may rate-limit repeated requests.</p></article><article><strong>Uploaded materials</strong><p>YOVA currently accepts readable PDF, TXT, and Markdown files. Scanned image-only PDFs may not contain extractable text.</p></article><article><strong>AI output</strong><p>Plans and explanations can be wrong. Include the goal and the specific output that was unhelpful, but do not paste sensitive school records.</p></article></div></section>
    <SupportForm />
  </TrustPage>;
}
