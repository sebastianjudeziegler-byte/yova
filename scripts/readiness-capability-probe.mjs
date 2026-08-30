export const SIGNED_IN_GENERATION_CONTRACT_VERSION = "202608300001";

const PROBE_RPC = "signed_in_generation_readiness_v1";

export async function probeSignedInGenerationDatabase({
  supabaseUrl,
  supabaseSecretKey,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}) {
  const endpoint = `${supabaseUrl.replace(/\/$/u, "")}/rest/v1/rpc/${PROBE_RPC}`;
  const headers = {
    apikey: supabaseSecretKey,
    "Content-Type": "application/json",
    "User-Agent": "YOVA-release-readiness/1.0",
    ...(isLegacyJwtKey(supabaseSecretKey)
      ? { Authorization: `Bearer ${supabaseSecretKey}` }
      : {}),
  };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return {
      passed: false,
      detail: "could not reach the configured Supabase project for the read-only capability probe",
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const missingProbe = response.status === 404
      || readString(payload, "code") === "PGRST202";
    return {
      passed: false,
      detail: missingProbe
        ? `missing database readiness RPC; apply migration ${SIGNED_IN_GENERATION_CONTRACT_VERSION} after all earlier migrations`
        : `database capability probe returned HTTP ${response.status}`,
    };
  }

  if (!isRecord(payload)) {
    return {
      passed: false,
      detail: "database capability probe returned an invalid response",
    };
  }

  if (payload.contractVersion !== SIGNED_IN_GENERATION_CONTRACT_VERSION) {
    return {
      passed: false,
      detail: "database readiness contract is stale for this application release",
    };
  }

  const completeContract = payload.ready === true
    && payload.studyRoutesSchema === true
    && payload.planSessionsRoutePointer === true
    && payload.requiredRouteRpcs === true;
  if (!completeContract) {
    const missing = [
      ["studyRoutesSchema", "StudyRoute table/columns"],
      ["planSessionsRoutePointer", "plan-session route pointer"],
      ["requiredRouteRpcs", "StudyRoute activation/cache RPCs"],
    ]
      .filter(([key]) => payload[key] !== true)
      .map(([, label]) => label);
    return {
      passed: false,
      detail: `database is missing ${missing.join(", ") || "required signed-in generation capabilities"}`,
    };
  }

  return {
    passed: true,
    detail: `StudyRoute schema and RPC contract ${SIGNED_IN_GENERATION_CONTRACT_VERSION} is available`,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value, key) {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function isLegacyJwtKey(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}
