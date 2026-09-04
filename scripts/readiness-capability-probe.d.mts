export const SIGNED_IN_GENERATION_CONTRACT_VERSION: "202608310003";
export const STUDY_PROFILE_PUBLIC_CONTRACT_VERSION: "202608310002";
export const PUBLIC_LAUNCH_ABUSE_CONTRACT_VERSION: "202609040002";

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

export function probeStudyProfilePublicDatabase(options: {
  supabaseUrl: string;
  supabaseSecretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReadinessCapabilityProbeResult>;

export function probePublicLaunchAbuseDatabase(options: {
  supabaseUrl: string;
  supabaseSecretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReadinessCapabilityProbeResult>;
