import { z } from "zod";
import { CORE_METHOD_IDS } from "@/lib/learning/method-catalog";

/**
 * Method preferences are stored and transported in catalog order so the same
 * learner choice has one canonical serialized representation everywhere.
 */
export const CanonicalPreferredMethodIdsSchema = z.array(z.enum(CORE_METHOD_IDS))
  .max(3)
  .refine((methodIds) => (
    methodIds.every((methodId, index) => (
      index === 0
      || CORE_METHOD_IDS.indexOf(methodIds[index - 1]!)
        < CORE_METHOD_IDS.indexOf(methodId)
    ))
  ), "Preferred methods must be unique and use canonical catalog order.");

export type CanonicalPreferredMethodIds = z.infer<
  typeof CanonicalPreferredMethodIdsSchema
>;
