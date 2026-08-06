import type { Metadata } from "next";
import Link from "next/link";
import { TrustPage } from "@/components/trust-page";

export const metadata: Metadata = {
  title: "Private Alpha Terms · YOVA",
  description: "The current terms for using the YOVA private alpha.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <TrustPage eyebrow="PRIVATE ALPHA TERMS" title="A learning tool—not a promise of results." summary="These terms set straightforward expectations while YOVA is being tested and improved.">
    <section><h2>1. Using the alpha</h2><p>By creating an account or using YOVA, you agree to these terms and the <Link href="/privacy">Privacy Notice</Link>. You must be at least 13. If you are under the age of majority where you live, you must have permission from a parent or legal guardian.</p></section>
    <section><h2>2. What YOVA provides</h2><p>YOVA creates educational plans, resources, guided sessions, and tutoring assistance. The private alpha may change, become unavailable, produce errors, or lose features as testing continues. Access is currently offered for evaluation and may be limited or ended.</p></section>
    <section><h2>3. Educational and AI limitations</h2><p>YOVA can be incomplete or wrong. It does not guarantee grades, test performance, mastery, admissions outcomes, or professional qualifications. Verify important information against your instructor, official course materials, or another authoritative source. YOVA is not a substitute for a teacher, school accommodation, medical professional, or emergency service.</p></section>
    <section><h2>4. Your responsibilities</h2><p>Use YOVA lawfully and follow your school’s academic-integrity rules. Do not use it to impersonate someone, cheat on restricted work, disrupt the service, probe private systems, evade usage limits, upload malicious content, or infringe another person’s rights. Upload only material you have permission to use.</p></section>
    <section><h2>5. Your content</h2><p>You retain your rights in material you upload. You allow YOVA and its service providers to process that material only as needed to operate, secure, support, and improve the product as described in the Privacy Notice. Do not upload highly sensitive personal records that are unnecessary for your learning goal.</p></section>
    <section><h2>6. Availability and responsibility</h2><p>The private alpha is provided on an “as available” basis. To the extent permitted by law, YOVA is not responsible for indirect losses caused by relying on generated content, missed deadlines, service interruptions, or loss of access. Nothing here limits rights that cannot legally be limited.</p></section>
    <section><h2>7. Changes and questions</h2><p>These terms may change as YOVA develops. Continued use after an updated version is posted means you accept the revised terms. Questions or account requests can be submitted through <Link href="/support">YOVA Support</Link>.</p></section>
  </TrustPage>;
}
