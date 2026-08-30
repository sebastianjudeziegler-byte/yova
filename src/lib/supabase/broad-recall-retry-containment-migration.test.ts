import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608300002_broad_recall_checkpoint_retry_containment.sql",
), "utf8").toLocaleLowerCase();

describe("Broad Recall checkpoint retry containment migration", () => {
  it("changes only the three existing storage guards in one additive transaction", () => {
    expect(migration.trimStart().indexOf("begin;\n")).toBeGreaterThanOrEqual(0);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    for (const guard of [
      "guard_broad_recall_checkpoint_binding_v1",
      "guard_broad_recall_attempt_binding_v1",
      "guard_broad_recall_event_binding_v1",
    ]) {
      expect(migration.match(new RegExp(
        `create or replace function public\\.${guard}\\(\\)`,
        "gu",
      ))).toHaveLength(1);
    }
    expect(migration).not.toContain(
      "create or replace function public.save_active_session_checkpoint_with_route",
    );
    expect(migration).not.toContain(
      "create or replace function public.assert_broad_recall_progress_binding_v1",
    );
    expect(migration).not.toMatch(/\b(?:insert|update|delete|truncate)\s+(?:from\s+|into\s+)?public\./u);
  });

  it("uses null-safe marker detection in every durable storage guard", () => {
    expect(migration).toContain(
      "checkpoint is not distinct from old.step_data -> 'activesessioncheckpoint'",
    );
    expect(migration.match(
      /pg_catalog\.jsonb_typeof\(progress\) is distinct from 'object'/gu,
    )).toHaveLength(3);
    expect(migration.match(
      /progress ->> 'kind' is distinct from 'broad_recall'/gu,
    )).toHaveLength(3);
    expect(migration).not.toContain("pg_catalog.jsonb_typeof(progress) <> 'object'");
    expect(migration).not.toContain("progress ->> 'kind' <> 'broad_recall'");
    expect(migration).toContain(
      "new.event_type is distinct from 'session_interrupted'",
    );
  });

  it("preserves the complete fail-closed Broad Recall contract", () => {
    expect(migration).toContain(
      "progress ->> 'activityindex' is distinct from completed_steps::text",
    );
    expect(migration).toContain("checkpoint -> 'pendingrepair' is not null");
    expect(migration).toContain("checkpoint -> 'evidence' is not null");
    expect(migration).toContain(
      "perform public.assert_broad_recall_progress_binding_v1(",
    );
    expect(migration.match(/errcode = '55000'/gu)).toHaveLength(2);
    expect(migration.match(
      /message = 'broad_recall_interruption_resource_identity_required'/gu,
    )).toHaveLength(2);
  });

  it("uses a non-retryable SQLSTATE for every deterministic local rejection", () => {
    expect(migration.match(/errcode = '22023'/gu)).toHaveLength(4);
    expect(migration).not.toContain("errcode = '40001'");
    expect(migration).toContain("message = 'broad_recall_progress_binding_conflict'");
    expect(migration).toContain("message = 'broad_recall_unverified_evidence_forbidden'");
  });

  it("translates only the helper's exact business conflict and rethrows other 40001 errors", () => {
    expect(migration).toContain("exception when sqlstate '40001' then");
    expect(migration).toContain(
      "if sqlerrm is distinct from 'broad_recall_progress_binding_conflict' then\n      raise;",
    );
    expect(migration).toContain(
      "deterministic binding rejections use 22023",
    );
  });

  it("retains the private trigger security boundary", () => {
    expect(migration.match(/security definer\nset search_path = ''/gu)).toHaveLength(3);
    for (const guard of [
      "guard_broad_recall_checkpoint_binding_v1",
      "guard_broad_recall_attempt_binding_v1",
      "guard_broad_recall_event_binding_v1",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${guard}()\nfrom public, anon, authenticated`,
      );
      expect(migration).not.toContain(
        `grant execute on function public.${guard}`,
      );
    }
  });
});
