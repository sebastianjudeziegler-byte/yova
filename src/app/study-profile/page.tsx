import type { Metadata } from "next";
import { CanonicalStudyProfileExperience } from "@/components/study-profile/canonical-study-profile-experience";

const title = "YOVA Study Profile | Build your canonical study setup";
const description = "Answer 11 optional questions to create the same changeable study profile YOVA uses for valid choices, timing, support, and presentation.";

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
    images: [{
      url: "/yova-study-profile-social.png",
      width: 1731,
      height: 909,
      alt: "YOVA Study Profile: practical study recommendations based on your answers.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/yova-study-profile-social.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function StudyProfilePage() {
  return <CanonicalStudyProfileExperience />;
}
