import type { Metadata } from "next";
import { StudyProfileExperience } from "@/components/study-profile/study-profile-experience";

const title = "YOVA Study Profile · Discover How Your Study System Should Adapt";
const description = "Take YOVA’s free 3-minute Study Profile and get an initial personalized report on how you start, focus, and follow through.";

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
      alt: "YOVA Study Profile — Your study system should adapt to you.",
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
