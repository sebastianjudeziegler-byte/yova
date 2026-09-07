import { DashboardError, FounderPageHeader } from "@/components/founder-dashboard";
import { FounderPeopleDirectory } from "@/components/founder-people-directory";
import {
  FounderPeopleAccessError,
  FounderPeopleDataError,
  loadFounderPeopleDirectory,
} from "@/lib/founder/people-data";
import type { FounderPeopleDirectoryResponse } from "@/lib/founder/people";

export const dynamic = "force-dynamic";

export default async function FounderPeoplePage() {
  let initialData: FounderPeopleDirectoryResponse;

  try {
    initialData = await loadFounderPeopleDirectory({
      search: "",
      kind: "all",
      status: "all",
      cursor: null,
      limit: 25,
    });
  } catch (error) {
    if (error instanceof FounderPeopleAccessError) {
      return error.status === 401
        ? <DashboardError title="Sign in first" body="Use your YOVA founder account, then reopen this private directory." />
        : <DashboardError title="Founder access required" body="This directory contains private contact information and is available only to YOVA's founder account." />;
    }

    if (error instanceof FounderPeopleDataError) {
      console.error("YOVA founder people directory failed", { code: error.code });
    }

    return <DashboardError title="Users and leads unavailable" body="YOVA could not load the private directory right now. Refresh in a moment." />;
  }

  return (
    <>
      <FounderPageHeader
        eyebrow="Founder operations"
        title="Users & leads"
        description="See who has created a YOVA account, unlocked a Study Profile, confirmed the waitlist, or is still waiting for tester access."
      />
      <FounderPeopleDirectory initialData={initialData} />
    </>
  );
}
