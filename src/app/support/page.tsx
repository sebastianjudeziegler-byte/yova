import type { Metadata } from "next";
import { SupportForm } from "@/components/support-form";
import { TrustPage } from "@/components/trust-page";
import { MATERIAL_FORMAT_LABEL } from "@/lib/materials/formats";

export const metadata: Metadata = {
  title: "Support · YOVA",
  description: "Support and troubleshooting for YOVA alpha users.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return <TrustPage eyebrow="YOVA SUPPORT" title="Help us see what you saw." summary="Signed-in alpha users can send a problem or product suggestion directly to the YOVA support queue.">
    <section className="support-basics"><h2>Before sending</h2><div><article><strong>Account access</strong><p>Use your password, or choose the email-code option and use the newest YOVA email. If a password reset link expired, request a fresh one.</p></article><article><strong>Uploaded materials</strong><p>YOVA accepts {MATERIAL_FORMAT_LABEL} files, up to 10 MB each. Upload PowerPoint slides directly as .pptx. For older .ppt files, save a .pptx or export a PDF first.</p></article><article><strong>AI output</strong><p>Plans and explanations can be wrong. Include the goal and the specific output that was unhelpful, but do not paste sensitive school records.</p></article></div></section>
    <SupportForm />
  </TrustPage>;
}
