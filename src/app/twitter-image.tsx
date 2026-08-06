import { ImageResponse } from "next/og";
import { YovaSocialImage } from "@/lib/metadata/social-image";

export const alt = "YOVA · Know exactly what to study next";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(<YovaSocialImage />, size);
}
