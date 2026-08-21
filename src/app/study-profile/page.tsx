import type { Metadata } from "next";
import { StudyProfileExperience } from "@/components/study-profile/study-profile-experience";

const title = "YOVA Study Profile | Get practical study recommendations";
const description = "Rereading feels like studying. It usually is not. Answer 14 questions and get study methods matched to how you actually work.";

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
  return <StudyProfileExperience />;
}
