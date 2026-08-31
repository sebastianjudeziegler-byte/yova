import { ImageResponse } from "next/og";
import {
  loadStudyProfileSocialFonts,
  StudyProfileSocialImage,
} from "@/lib/metadata/study-profile-social-image";

export const alt = "Free YOVA Study Profile showing a named study pattern and practical methods.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function StudyProfileTwitterImage() {
  return new ImageResponse(<StudyProfileSocialImage />, {
    ...size,
    fonts: await loadStudyProfileSocialFonts(),
  });
}
