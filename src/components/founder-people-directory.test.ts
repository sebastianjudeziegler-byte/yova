import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FounderPeopleDirectory } from "@/components/founder-people-directory";
import { directoryRow } from "@/lib/founder/people.test-support";

describe("FounderPeopleDirectory", () => {
  it("renders private people records with accessible filters and truthful lifecycle labels", () => {
    const html = renderToStaticMarkup(createElement(FounderPeopleDirectory, {
      initialData: {
        generatedAt: "2026-09-07T12:00:00.000Z",
        summary: {
          uniquePeople: 1,
          yovaAccounts: 1,
          studyProfileLeads: 1,
          confirmedWaitlist: 1,
          pendingInvites: 0,
        },
        total: 1,
        rows: [directoryRow()],
        hasMore: false,
        nextCursor: null,
      },
    }));

    expect(html).toContain('aria-label="Filter users and leads"');
    expect(html).toContain('type="search"');
    expect(html).toContain("YOVA accounts");
    expect(html).toContain("Study Profile leads");
    expect(html).toContain("learner@example.com");
    expect(html).toContain("Matched by current email");
    expect(html).toContain("Waitlist confirmed");
    expect(html).toContain("Only people with a confirmed waitlist status");
    expect(html).not.toContain("abandoned");
    expect(html).not.toContain("learner%40example.com");
    expect(html).not.toContain("mailto:");
  });

  it("uses no-report language for a waitlist-only lead", () => {
    const html = renderToStaticMarkup(createElement(FounderPeopleDirectory, {
      initialData: {
        generatedAt: "2026-09-07T12:00:00.000Z",
        summary: {
          uniquePeople: 1,
          yovaAccounts: 0,
          studyProfileLeads: 1,
          confirmedWaitlist: 1,
          pendingInvites: 0,
        },
        total: 1,
        rows: [directoryRow({
          kind: "lead",
          matchBasis: null,
          displayName: null,
          hasYovaAccount: false,
          accountCreatedAt: null,
          emailConfirmedAt: null,
          lastSignInAt: null,
          onboardingCompletedAt: null,
          inviteStatus: null,
          invitedAt: null,
          joinedAt: null,
          lastProductActivityAt: null,
          plansCount: 0,
          sessionsCompleted: 0,
          studyMinutes: 0,
          profileStatus: "waitlist_only",
          reportCount: 0,
          latestReportAt: null,
          reportEmailStatus: null,
          reportEmailSentAt: null,
          reportViewedAt: null,
        })],
        hasMore: false,
        nextCursor: null,
      },
    }));

    expect(html).toContain("No report linked");
    expect(html).not.toContain("abandoned");
  });
});
