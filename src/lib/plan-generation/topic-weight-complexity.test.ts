import { expect,it } from "vitest";
import { topicWeight } from "./topic-plan-model";
import { deltaFixture } from "@/evals/personalization-delta-fixture";

it("bounds prerequisite traversal for a densely connected accepted map",()=>{
 const base=deltaFixture(2).request.knowledgeMap!.topics[0]!;let prerequisiteReads=0;
 const topics=Array.from({length:18},(_,index)=>({...base,id:`92000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,subtopics:[],prerequisiteTopicIds:[] as string[]}));
 for(const [index,topic]of topics.entries()){const ids=topics.slice(0,index).map(prerequisite=>prerequisite.id);Object.defineProperty(topic,"prerequisiteTopicIds",{get:()=>{prerequisiteReads++;return ids;},enumerable:true});}
 expect(topicWeight(topics.at(-1)!,topics)).toBe(18);
 expect(prerequisiteReads).toBeLessThan(500);
});
