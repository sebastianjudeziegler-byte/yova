import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("not-found page", () => {
  it("does not emit a second title alongside root metadata", () => {
    const html = renderToStaticMarkup(NotFound());

    expect(html).not.toContain("<title>");
    expect(html).toContain("There’s nothing to study here.");
  });
});
