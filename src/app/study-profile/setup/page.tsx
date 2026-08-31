import type { Metadata } from "next";
import { CanonicalStudyProfileExperience } from "@/components/study-profile/canonical-study-profile-experience";

const title = "YOVA Study Setup | Personalize how YOVA works with you";
const description = "Answer 11 optional questions to create the changeable study setup YOVA uses for valid choices, timing, support, and presentation.";

export const metadata: Metadata = {
  title,
  description,
  referrer: "no-referrer",
  alternates: {
    canonical: "/study-profile/setup",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function StudyProfileSetupPage() {
  return <CanonicalStudyProfileExperience />;
}
