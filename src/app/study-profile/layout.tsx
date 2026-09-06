import { Suspense, type ReactNode } from "react";
import { MetaPixel } from "@/components/meta-pixel";
import { getMetaConsentRequestContext } from "@/lib/meta-consent-server";
import { shouldLoadMetaPixel } from "@/lib/meta-pixel";

export default function StudyProfileLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const configuredPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  const pixelId = shouldLoadMetaPixel(
    process.env.VERCEL_ENV,
    configuredPixelId,
    process.env.NODE_ENV,
  )
    ? configuredPixelId
    : null;

  return (
    <>
      {children}
      {pixelId ? (
        <Suspense fallback={null}>
          <RequestScopedMetaPixel pixelId={pixelId} />
        </Suspense>
      ) : null}
    </>
  );
}

async function RequestScopedMetaPixel({ pixelId }: { pixelId: string }) {
  const consent = await getMetaConsentRequestContext();
  return <MetaPixel pixelId={pixelId} {...consent} />;
}
