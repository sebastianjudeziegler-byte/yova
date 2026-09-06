import { statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile }));

describe("loadStudyProfileSocialFonts", () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset().mockImplementation(async (path: string) => Buffer.from(path));
  });

  it("defers project-owned font reads until the image route asks for them and caches the result", async () => {
    const socialImage = await import("@/lib/metadata/study-profile-social-image");

    expect(readFile).not.toHaveBeenCalled();

    const fontDirectory = join(process.cwd(), "assets", "fonts", "study-profile");
    const expectedPaths = [
      join(fontDirectory, "inter-latin-700-normal.woff"),
      join(fontDirectory, "newsreader-latin-500-normal.woff"),
      join(fontDirectory, "jetbrains-mono-latin-700-normal.woff"),
    ];
    const firstLoad = socialImage.loadStudyProfileSocialFonts();
    const secondLoad = socialImage.loadStudyProfileSocialFonts();

    expect(secondLoad).toBe(firstLoad);
    const fonts = await firstLoad;

    expect(readFile).toHaveBeenCalledTimes(3);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(expectedPaths);
    expect(expectedPaths.every((path) => !path.includes("node_modules"))).toBe(true);
    expect(fonts.map(({ name, weight }) => ({ name, weight }))).toEqual([
      { name: "Inter", weight: 700 },
      { name: "Newsreader", weight: 500 },
      { name: "JetBrains Mono", weight: 700 },
    ]);

    await socialImage.loadStudyProfileSocialFonts();
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it("ships each traced font as a non-empty project asset", () => {
    const fontDirectory = join(process.cwd(), "assets", "fonts", "study-profile");

    for (const filename of [
      "inter-latin-700-normal.woff",
      "newsreader-latin-500-normal.woff",
      "jetbrains-mono-latin-700-normal.woff",
    ]) {
      expect(statSync(join(fontDirectory, filename)).size).toBeGreaterThan(20_000);
    }
  });
});
