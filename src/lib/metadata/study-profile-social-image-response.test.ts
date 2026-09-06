import { describe, expect, it } from "vitest";
import StudyProfileOpenGraphImage from "@/app/study-profile/opengraph-image";
import StudyProfileTwitterImage from "@/app/study-profile/twitter-image";

describe("Study Profile social image routes", () => {
  it.each([
    ["Open Graph", StudyProfileOpenGraphImage],
    ["Twitter", StudyProfileTwitterImage],
  ])("renders the %s image with the project-owned fonts", async (_label, renderImage) => {
    const response = await renderImage();
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });
});
