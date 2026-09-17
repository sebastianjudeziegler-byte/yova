import "server-only";
import { MaterialUnderstandingSchema, PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { applyPlanMaterialUnderstanding } from "@/lib/plan-generation/plan-material-understanding";
import { TopicWorkloadSchema } from "@/lib/plan-generation/topic-plan-contract";
import { classifyLearningTask } from "@/lib/learning/method-router";
import { baselineSourceForTopics } from "@/lib/session-shapes/source-context";
import { ShapeSlotRequestSchema, type ShapeSlotRequest } from "@/lib/session-shapes/slots-schema";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

/** Called after the operational-session guard and before quota reservation.
 * Posted source text is never an authority for an authenticated session. */
export async function hydrateShapeSlotContext(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, request: ShapeSlotRequest): Promise<ShapeSlotRequest> {
  const saved = await supabase.from("plans").select("learning_item_id,generation_inputs,knowledge_map").eq("id",request.planId).eq("user_id",userId).maybeSingle();
  if(saved.error || !saved.data) throw new Error("The saved plan context could not be verified.");
  const map=PlanKnowledgeMapSchema.parse(saved.data.knowledge_map);
  const session=await supabase.from("plan_sessions").select("step_data").eq("id",request.planSessionId).eq("plan_id",request.planId).maybeSingle();
  if(session.error || !session.data)throw new Error("The saved session context could not be verified.");
  const stepData=session.data.step_data && typeof session.data.step_data==="object"?session.data.step_data as Record<string,unknown>:{};
  const workload=stepData.workload==null?null:TopicWorkloadSchema.parse(stepData.workload);
  if(workload&&!workload.topicSubtopics.some(topic=>topic.topicId===request.topic.id))throw new Error("That topic is not in the saved session workload.");
  const selected=new Map(workload?workload.topicSubtopics.map(topic=>[topic.topicId,topic.subtopics]):[request.topic,...(request.topic.relatedTopics??[])].map(topic=>[topic.id,topic.subtopics]));
  const ids=[...selected.keys()];
  const topics=ids.map(id=>map.topics.find(topic=>topic.id===id&&!topic.removed&&!topic.deferred));
  if(topics.some(topic=>!topic))throw new Error("That topic is not in the saved plan.");
  const accepted=topics.flatMap(topic=>topic?[topic]:[]);
  const materials=await supabase.from("materials").select("id,filename,mime_type,byte_size,extracted_text,metadata").eq("learning_item_id",saved.data.learning_item_id).eq("user_id",userId).eq("processing_status","ready").order("created_at",{ascending:true}).limit(5);
  if(materials.error)throw new Error("The saved sources could not be verified.");
  const inputs=saved.data.generation_inputs && typeof saved.data.generation_inputs==="object" ? saved.data.generation_inputs as Record<string,unknown> : {};
  const scopedIds=Array.isArray(inputs.revisionMaterialIds)?new Set(inputs.revisionMaterialIds):null;
  const authorizedMaterials=applyPlanMaterialUnderstanding((materials.data??[]).filter(row=>!scopedIds||scopedIds.has(row.id)).map(row=>{
    const metadata=row.metadata && typeof row.metadata==="object" ? row.metadata as Record<string,unknown>:{};
    const understanding=MaterialUnderstandingSchema.safeParse(metadata.materialUnderstanding??metadata.understanding);
    return {id:row.id,name:row.filename,mimeType:row.mime_type,sizeBytes:row.byte_size,processingStatus:"ready" as const,textContent:row.extracted_text,understanding:understanding.success?understanding.data:undefined};
  }),inputs);
  const source=baselineSourceForTopics({materials:authorizedMaterials,sourceMode:"user_materials"},accepted);
  const main=accepted[0]!;
  const goal=typeof inputs.goal==="string"?inputs.goal.slice(0,1200):undefined;
  const selectedSubtopics=(item:typeof main)=>{
    const subtopics=selected.get(item.id)??[];
    return workload||subtopics.length?subtopics.filter(subtopic=>item.subtopics.includes(subtopic)):item.subtopics;
  };
  const topic={...request.topic,id:main.id,title:main.title,description:main.description,subtopics:selectedSubtopics(main),
    taskType:classifyLearningTask([goal,main.title,main.description,...main.subtopics].join(" ")).taskType,learningGoal:goal,
    ...(accepted.length>1?{relatedTopics:accepted.slice(1).map(item=>({id:item.id,title:item.title,subtopics:selectedSubtopics(item)}))}:{relatedTopics:undefined})};
  if(request.action==="direction")return ShapeSlotRequestSchema.parse({...request,topic,source:source.description,excerpts:source.excerpts});
  if(request.action==="practice")return ShapeSlotRequestSchema.parse({...request,topic,excerpts:source.excerpts});
  if(request.action==="compare")return ShapeSlotRequestSchema.parse({...request,topic,reference:{...request.reference,excerpts:source.excerpts}});
  return ShapeSlotRequestSchema.parse({...request,topic});
}
