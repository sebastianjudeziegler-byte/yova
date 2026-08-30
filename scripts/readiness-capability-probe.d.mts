export const SIGNED_IN_GENERATION_CONTRACT_VERSION: "202608300001";

export interface ReadinessCapabilityProbeResult {
  passed: boolean;
  detail: string;
}

export function probeSignedInGenerationDatabase(options: {
  supabaseUrl: string;
  supabaseSecretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReadinessCapabilityProbeResult>;
