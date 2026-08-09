import { describe, expect, it } from "vitest";
import { materialStoragePath, sanitizeMaterialDisplayName } from "./filename";

describe("material filenames", () => {
  it("preserves a readable Unicode display name", () => {
    expect(sanitizeMaterialDisplayName("World War I — Study Guide.pdf"))
      .toBe("World War I — Study Guide.pdf");
  });

  it("never places the original filename in the private object key", () => {
    expect(materialStoragePath(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "application/pdf",
    )).toBe(
      "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/source.pdf",
    );
  });

  it("uses a stable extension for each supported material type", () => {
    expect(materialStoragePath("user", "material", "text/plain")).toBe("user/material/source.txt");
    expect(materialStoragePath("user", "material", "text/markdown")).toBe("user/material/source.md");
  });
});
