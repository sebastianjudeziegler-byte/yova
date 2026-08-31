import type { Metadata } from "next";
import Link from "next/link";
import { TrustPage } from "@/components/trust-page";

export const metadata: Metadata = {
  title: "Terms · YOVA",
  description: "The current terms for using the YOVA Study Profile and alpha.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <TrustPage eyebrow="YOVA TERMS" title="A learning tool, not a promise of results." summary="These terms set straightforward expectations while YOVA is being tested and improved." updated="August 31, 2026">
    <section><h2>1. Using YOVA</h2><p>By taking the public Study Profile, requesting to join the waitlist, creating an account, or otherwise using YOVA, you agree to these terms and the <Link href="/privacy">Privacy Notice</Link>. You must be at least 13. When a signup flow asks, you must affirm that you are at least 13. If you are under the age of majority where you live, you must have permission from a parent or legal guardian.</p></section>
    <section><h2>2. What YOVA provides</h2><p>The public Study Profile provides a report based on your answers and suggested study methods. A waitlist request remains pending until you open its private confirmation page and select the confirmation button. Opening the link alone does not join the waitlist. The requested report and waitlist confirmation emails are transactional messages. YOVA will not send marketing waitlist campaigns before working unsubscribe controls and bounce and complaint suppression are in place. The alpha may also create educational plans, resources, guided sessions, and tutoring assistance. Prelaunch features may change, become unavailable, produce errors, or lose features as testing continues. Access is offered for evaluation and may be limited or ended.</p></section>
    <section><h2>3. Educational, assessment, and AI limitations</h2><p>YOVA can be incomplete or wrong. The Study Profile is not a validated psychological test and is not a medical, neurological, psychological, intelligence, or learning-style diagnosis. It does not identify a perfect study method or describe permanent traits. YOVA does not guarantee grades, test performance, mastery, admissions outcomes, or professional qualifications. Verify important information against your instructor, official course materials, or another authoritative source. YOVA is not a substitute for a teacher, school accommodation, medical professional, or emergency service.</p></section>
    <section><h2>4. Your responsibilities</h2><p>Use YOVA lawfully and follow your school’s academic-integrity rules. Do not use it to impersonate someone, cheat on restricted work, disrupt the service, probe private systems, evade usage limits, upload malicious content, or infringe another person’s rights. Upload only material you have permission to use.</p></section>
    <section><h2>5. Your content</h2><p>You retain your rights in material you upload. You allow YOVA and its service providers to process that material only as needed to operate, secure, support, and improve the product as described in the Privacy Notice. Do not upload highly sensitive personal records that are unnecessary for your learning goal.</p></section>
    <section><h2>6. Availability and responsibility</h2><p>YOVA&apos;s prelaunch services are provided on an “as available” basis. To the extent permitted by law, YOVA is not responsible for indirect losses caused by relying on an assessment or generated content, missed deadlines, service interruptions, or loss of access. Nothing here limits rights that cannot legally be limited.</p></section>
    <section><h2>7. Changes and questions</h2><p>These terms may change as YOVA develops. Continued use after an updated version is posted means you accept the revised terms. Questions or account requests can be submitted through <Link href="/support">YOVA Support</Link>.</p></section>
  </TrustPage>;
}
