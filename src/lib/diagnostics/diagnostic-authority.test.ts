import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { applyDiagnosticAnswers } from "@/lib/diagnostics/map-diagnostic";
import { issueKnowledgeMapReceipt, prepareDiagnosticChallenge, readDiagnosticChallenge, verifyKnowledgeMapReceipt } from "@/lib/diagnostics/diagnostic-authority";

const userId = "11111111-1111-4111-8111-111111111111";
const topicId = "22222222-2222-4222-8222-222222222222";
const map = PlanKnowledgeMapSchema.parse({
  version:1, scopeJudgment:{band:"focused_skill",label:"Elimination",minimumSessions:2,recommendedSessions:3,maximumSessions:4,minimumTeachingSessions:1,explanation:"Learn to eliminate a specified variable in two linear equations."},
  topics:[{id:topicId,title:"Elimination",description:"Choose an operation that eliminates a specified variable in two linear equations.",subtopics:[],prerequisiteTopicIds:[],status:"not_started",initialEvidence:null,sourceReferences:[],origin:"ai_generated",deferred:null}],
  placementCheck:{status:"available",completedAt:null,demonstratedTopicIds:[],gapTopicIds:[]},
});
const questions = [
  {id:"33333333-3333-4333-8333-333333333333",topicId,prompt:"For 2x+y=11 and 2x-y=1, which operation eliminates y?",options:["Add the equations","Subtract the equations","Multiply both by two","I don't know yet"],correctAnswer:"Add the equations"},
  {id:"44444444-4444-4444-8444-444444444444",topicId,prompt:"For x+3y=10 and x+y=4, which operation eliminates x?",options:["Add the equations","Subtract the equations","Multiply both by two","I don't know yet"],correctAnswer:"Subtract the equations"},
];

describe("placement evidence authority", () => {
  beforeEach(()=>vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET","placement-authority-test-secret-0123456789"));
  it("keeps the learner's Quick verification result when the clock ticks while signing", () => {
    const result = applyDiagnosticAnswers(map, questions, ["Add the equations", "Subtract the equations"], false);
    const currentTime = Date.now();
    const clock = vi.spyOn(Date, "now")
      .mockReturnValueOnce(currentTime)
      .mockReturnValue(currentTime + 1);
    try {
      const receipt = issueKnowledgeMapReceipt(result.map, userId);
      expect(verifyKnowledgeMapReceipt(result.map, receipt, userId)).toBe(true);
      expect(result.map.topics[0]!.initialEvidence?.outcome === "demonstrated" ? "Quick verification" : "Teach and check").toBe("Quick verification");
    } finally {
      clock.mockRestore();
    }
  });
  it("hides the answer key, scores two different questions, and authenticates the resulting map",()=>{
    const prepared = prepareDiagnosticChallenge({userId,planId:null,map,questions});
    expect(prepared.questions[0]).not.toHaveProperty("correctAnswer");
    expect(prepared.challengeToken).not.toContain("Add the equations");
    const challenge = readDiagnosticChallenge(prepared.challengeToken,userId,null);
    const result = applyDiagnosticAnswers(challenge.map,challenge.questions,["Add the equations","Subtract the equations"],false);
    const receipt = issueKnowledgeMapReceipt(result.map,userId);
    expect(verifyKnowledgeMapReceipt(result.map,receipt,userId)).toBe(true);
    expect(result.map.topics[0]!.initialEvidence?.outcome === "demonstrated" ? "Quick verification" : "Teach and check").toBe("Quick verification");
    expect(verifyKnowledgeMapReceipt({...result.map,topics:[{...result.map.topics[0]!,title:"Quadratic equations"}]},receipt,userId)).toBe(false);
    expect(verifyKnowledgeMapReceipt(result.map,receipt,"other-user")).toBe(false);
  });
  it("rejects another learner, another plan, tampered ciphertext, and expiry",()=>{
    const {challengeToken} = prepareDiagnosticChallenge({userId,planId:null,map,questions});
    expect(()=>readDiagnosticChallenge(challengeToken,"other-user",null)).toThrow();
    expect(()=>readDiagnosticChallenge(challengeToken,userId,topicId)).toThrow();
    const parts = challengeToken.split("."); parts[3] = `${parts[3]![0] === "a" ? "b" : "a"}${parts[3]!.slice(1)}`;
    expect(()=>readDiagnosticChallenge(parts.join("."),userId,null)).toThrow();
    const now = vi.spyOn(Date,"now").mockReturnValue(Date.now()+31*60_000);
    expect(()=>readDiagnosticChallenge(challengeToken,userId,null)).toThrow();
    now.mockRestore();
  });
  it("does not turn one right and one wrong answer, or a duplicated question, into demonstrated knowledge",()=>{
    const mixed = applyDiagnosticAnswers(map,questions,["Add the equations","Add the equations"],false);
    expect(mixed.map.placementCheck.demonstratedTopicIds).toEqual([]);
    expect(mixed.map.topics[0]!.initialEvidence?.outcome).toBe("gap");
    const duplicate = applyDiagnosticAnswers(map,[questions[0]!,{...questions[0]!,id:questions[1]!.id}],["Add the equations","Add the equations"],false);
    expect(duplicate.map.topics[0]!.initialEvidence).toBeNull();
  });
  it("accepts a previous signing key during rotation and rejects it after retirement",()=>{
    const {challengeToken} = prepareDiagnosticChallenge({userId,planId:null,map,questions});
    vi.stubEnv("YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET",process.env.YOVA_DRAFT_RECEIPT_SECRET!);
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET","rotated-placement-authority-secret-0123456789");
    expect(readDiagnosticChallenge(challengeToken,userId,null).questions).toEqual(questions);
    vi.stubEnv("YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET","");
    expect(()=>readDiagnosticChallenge(challengeToken,userId,null)).toThrow();
  });
});
