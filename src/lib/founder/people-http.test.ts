import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { directoryRow } from "@/lib/founder/people.test-support";
import {
  buildFounderPeopleCsv,
  csvCell,
  readBoundedFounderPeopleJson,
  validateFounderPeopleRequest,
} from "@/lib/founder/people-http";

describe("founder people HTTP and CSV helpers", () => {
  it("requires same-origin JSON requests", () => {
    expect(validateFounderPeopleRequest(request()).ok).toBe(true);
    expect(validateFounderPeopleRequest(request({ Origin: "https://attacker.example" }))).toEqual(
      expect.objectContaining({ ok: false, status: 403 }),
    );
    expect(validateFounderPeopleRequest(request({ "Content-Type": "text/plain" }))).toEqual(
      expect.objectContaining({ ok: false, status: 415 }),
    );
  });

  it("rejects bodies beyond the fixed byte limit", async () => {
    const oversized = request({}, { search: "x".repeat(4_200) });
    await expect(readBoundedFounderPeopleJson(oversized)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("neutralizes spreadsheet formulas after leading whitespace", () => {
    for (const value of ["=2+2", "+cmd", "-3+4", "@SUM(A1)", "  =2+2", "\t=2+2", "\r+cmd"]) {
      expect(csvCell(value)).toMatch(/^"'/);
    }
    expect(csvCell("ordinary")).toBe('"ordinary"');
  });

  it("exports fixed safe columns with RFC4180 escaping and omits age and Meta click data", () => {
    const csv = buildFounderPeopleCsv([directoryRow({
      displayName: 'Ada "A"\nLovelace',
      campaign: "=IMPORTXML(example)",
      ageBand: "13_17",
      hasMetaClick: true,
    })]);

    expect(csv).toContain('"Ada ""A""\nLovelace"');
    expect(csv).toContain('"\'=IMPORTXML(example)"');
    expect(csv).not.toContain("13_17");
    expect(csv).not.toContain("Meta click");
  });
});

function request(headers: Record<string, string> = {}, body: unknown = {}) {
  return new Request("https://yova.example/api/founder/people/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yova.example",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
