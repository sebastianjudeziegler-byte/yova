import type { Metadata } from "next";
import { StudyProfileExperience } from "@/components/study-profile/study-profile-experience";

const title = "Free YOVA Study Profile | Find out how you actually study";
const description = "Answer 14 quick questions and get your study pattern, a six-habit profile, matched methods, and a plan you can use tonight. Free, with no account.";

export const metadata: Metadata = {
  title,
  description,
  referrer: "no-referrer",
  alternates: {
    canonical: "/study-profile",
  },
  openGraph: {
    type: "website",
    url: "/study-profile",
    siteName: "YOVA",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function StudyProfilePage() {
  return <StudyProfileExperience />;
}
