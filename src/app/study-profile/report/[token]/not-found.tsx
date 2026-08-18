import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function StudyProfileReportNotFound() {
  return (
    <main className="centered-shell">
      <Link href="/study-profile" aria-label="Return to YOVA Study Profile">
        <BrandMark />
      </Link>
      <section className="setup-card">
        <span className="step-label">PRIVATE REPORT</span>
        <h1>That report link isn&apos;t available.</h1>
        <p>Check that the complete link from your YOVA email was copied. You can also take the Study Profile again to create a new private report.</p>
        <Link className="button primary large" href="/study-profile">
          Take the Study Profile
        </Link>
        <Link className="button ghost" href="/">
          <ArrowLeft size={17} /> Back to YOVA
        </Link>
      </section>
    </main>
  );
}
