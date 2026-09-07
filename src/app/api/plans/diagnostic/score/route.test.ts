import { beforeEach, expect, it, vi } from "vitest";
import { prepareDiagnosticChallenge } from "@/lib/diagnostics/diagnostic-authority";
import { buildPreviewMapDiagnostic } from "@/lib/diagnostics/map-diagnostic";
import { shortDeadlineRequest } from "@/evals/plan-creation-blocker-cases";
import { POST } from "@/app/api/plans/diagnostic/score/route";

vi.mock("server-only",()=>({}));
vi.mock("@/lib/server/development-preview",()=>({isDevelopmentPreviewRequest:()=>true}));
beforeEach(()=>vi.stubEnv("NODE_ENV","development"));

it("allows an identical retry but cannot turn a wrong answer into demonstrated knowledge by resubmitting the same check",async()=>{
  const map = shortDeadlineRequest(3).knowledgeMap!;
  const questions = buildPreviewMapDiagnostic(map);
  const prepared = prepareDiagnosticChallenge({map,questions,userId:"development-preview",planId:null,preview:true});
  const submit = (answers:string[])=>POST(new Request("http://localhost/api/plans/diagnostic/score",{method:"POST",body:JSON.stringify({challengeToken:prepared.challengeToken,answers})}));
  const wrong = questions.map(()=>"I don't know yet");
  expect((await submit(wrong)).status).toBe(200);
  expect((await submit(wrong)).status).toBe(200);
  const changed = await submit(questions.map(question=>question.correctAnswer));
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({error:expect.stringContaining("already submitted")});
});
