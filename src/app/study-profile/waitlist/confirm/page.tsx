import type { Metadata } from "next";
import { StudyProfileWaitlistConfirmation } from "@/components/study-profile/study-profile-waitlist-confirmation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Confirm your YOVA waitlist signup",
  description: "Confirm the email address you used for the YOVA waitlist.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

export default function StudyProfileWaitlistConfirmationPage() {
  return <StudyProfileWaitlistConfirmation />;
}
