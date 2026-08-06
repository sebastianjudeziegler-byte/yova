import type { Metadata } from "next";
import Link from "next/link";
import { TrustPage } from "@/components/trust-page";

export const metadata: Metadata = {
  title: "Privacy Notice · YOVA",
  description: "How the YOVA private alpha handles account, learning, material, tutor, and product data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <TrustPage eyebrow="PRIVACY NOTICE" title="Your learning data should be understandable." summary="This notice explains what the YOVA private alpha stores, why it uses that information, and which controls are already available.">
    <section><h2>1. What YOVA collects</h2><p>YOVA may store your account email and first name; onboarding preferences; learning goals, plans, and schedules; session completion, timing, quiz outcomes, confidence feedback, and interruptions; uploaded files and extracted text; tutor conversations; support requests; and limited technical or product events needed to operate and improve the alpha.</p><p>Technical error reports contain only bounded labels such as the affected product area, route, time, and an internal request reference. They do not contain your study material, tutor messages, typed answers, arbitrary error messages, or technical stack traces.</p><p>Your typed free-response answer stays in the active browser session. YOVA saves the concept outcome—such as secure or needs review—rather than the full typed response.</p></section>
    <section><h2>2. How YOVA uses it</h2><p>YOVA uses this information to authenticate you, save your work, create plans and activities, personalize the size and structure of future sessions, restore tutor context, prevent abuse, diagnose failures, provide support, and understand whether the core learning flow is useful.</p><p>YOVA does not treat one answer or interruption as a permanent fact about your ability. Diagnosed-condition answers are excluded from AI planning context.</p></section>
    <section><h2>3. AI and service providers</h2><p>Relevant instructions, learning context, and bounded excerpts from source material may be sent to OpenAI to generate plans, guided activities, explanations, questions, or tutor replies. Uploaded material is treated as untrusted source content, not as instructions to the system.</p><p>YOVA currently relies on Supabase for authentication, database storage, and private file storage; OpenAI for generation; and Vercel for application hosting. These providers process data as needed to deliver their part of the service.</p></section>
    <section><h2>4. Your controls</h2><p>Inside <strong>You</strong>, the Reset learning data control removes your learner profile, goals, plans, results, tutor conversations, analytics events, technical error reports, and private uploaded materials. Your login identity remains so you can sign in again. To request full account deletion, submit a request through <Link href="/support">YOVA Support</Link>.</p></section>
    <section><h2>5. Retention and security</h2><p>Private-alpha learning data is kept while your account remains active unless you remove it. Limited support or security records may be retained when reasonably needed to resolve a request, prevent abuse, or meet legal obligations. YOVA uses account authentication, database ownership rules, private file storage, server-only API credentials, validation, and rate limits. No online system can promise perfect security.</p></section>
    <section><h2>6. Age and changes</h2><p>The private alpha is intended for people age 13 or older. If you are under the age of majority where you live, use YOVA only with permission from a parent or legal guardian. This notice may change as the alpha develops; the updated date at the top will change when it does.</p></section>
  </TrustPage>;
}
