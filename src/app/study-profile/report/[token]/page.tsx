import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ZodError } from "zod";
import { BrandMark } from "@/components/brand-mark";
import { StudyProfileReportView } from "@/components/study-profile/study-profile-report-view";
import {
  StudyProfileReportTokenSchema,
  toStudyProfilePublicStoredResponse,
} from "@/lib/study-profile";
import {
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
} from "@/lib/study-profile/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Study Profile · YOVA",
  description: "Your private YOVA Study Profile report and practical study recommendations.",
  alternates: { canonical: "/study-profile" },
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

export default async function StudyProfileReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: tokenInput } = await params;
  const token = StudyProfileReportTokenSchema.safeParse(tokenInput);
  if (!token.success) notFound();

  const loaded = await loadStudyProfileReport(token.data);
  if (loaded.status === "not_found") notFound();
  if (loaded.status === "unavailable") {
    return (
      <main className="centered-shell">
        <Link href="/study-profile" aria-label="Return to YOVA Study Profile">
          <BrandMark />
        </Link>
        <section className="setup-card">
          <span className="step-label">PRIVATE REPORT</span>
          <h1>Your report is taking a little longer.</h1>
          <p>YOVA could not open this private report right now. Your link has not changed; wait a moment and try it again.</p>
          <Link className="button primary large" href={`/study-profile/report/${token.data}`}>
            Try again
          </Link>
          <Link className="button ghost" href="/study-profile">
            <ArrowLeft size={17} /> Back to Study Profile
          </Link>
        </section>
      </main>
    );
  }

  return (
    <StudyProfileReportView
      storedResponse={toStudyProfilePublicStoredResponse(loaded.saved.storedResponse)}
      report={loaded.saved.report}
      reportToken={token.data}
      initialWaitlistJoined={loaded.saved.waitlistJoined}
      initialWaitlistConfirmationPending={loaded.saved.confirmationPending}
    />
  );
}

async function loadStudyProfileReport(token: string) {
  try {
    const repository = getStudyProfileRepository();
    const saved = await repository.getReportByToken(token);
    if (!saved) return { status: "not_found" as const };
    return { status: "ready" as const, repository, saved };
  } catch (error) {
    if (!(error instanceof StudyProfilePersistenceUnavailableError)) {
      console.error(
        "Study Profile report page failed.",
        safeStudyProfileErrorDetails(error),
      );
    }
    return { status: "unavailable" as const };
  }
}

function safeStudyProfileErrorDetails(error: unknown) {
  if (error instanceof ZodError) {
    return {
      name: error.name,
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })),
    };
  }
  return { name: error instanceof Error ? error.name : "UnknownError" };
}
