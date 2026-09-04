import nextEnv from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd(), false);

const suppliedOrigin = process.argv
  .slice(2)
  .find((argument) => argument !== "--" && !argument.startsWith("-"))
  ?.trim();
const writesAcknowledged = process.argv.includes("--acknowledge-production-writes");
const runSmtpProbe = process.argv.includes("--smtp-probe");

const origin = productionOrigin(suppliedOrigin);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

if (!origin || !writesAcknowledged) {
  console.error(
    "Usage: pnpm smoke:production:lifecycle -- https://your-yova-domain.com --acknowledge-production-writes [--smtp-probe]",
  );
  console.error("This canary creates and permanently deletes isolated release-test accounts.");
  process.exit(1);
}
if (!supabaseUrl || !publishableKey || !secretKey) {
  console.error(
    "The production Supabase URL, publishable key, and server secret must be configured.",
  );
  process.exit(1);
}

const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

let smtpProbeUserId = null;
let canaryUserId = null;
let stagedMaterialId = null;
let stagedMaterialStoragePath = null;
let rejectedStoragePath = null;
let deletionLearningStoragePath = null;
let deletionExportStoragePath = null;
let exportId = null;
let sessionCookie = null;
let accountDeletedByYova = false;
const cleanupFailures = [];

try {
  const status = await readJson(`${origin}/api/system/status`);
  assert(status.response.ok, `system status returned ${status.response.status}`);
  for (const [key, expected] of Object.entries({
    signedInGeneration: "ready",
    launchAbuseProtection: "ready",
    accountDataExport: "enabled",
    accountDeletion: "enabled",
  })) {
    assert(status.body?.[key] === expected, `${key} expected ${expected}`);
  }
  pass("deployed lifecycle and abuse-control capabilities are ready");

  const captchaProbe = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { error: captchaError } = await captchaProbe.auth.signInWithOtp({
    email: `delivered+captcha-${runId}@resend.dev`,
    options: { shouldCreateUser: false },
  });
  assert(
    captchaError
      && Number(captchaError.status) >= 400
      && Number(captchaError.status) < 500
      && (
        captchaError.code === "captcha_failed"
        || /captcha verification process failed/i.test(captchaError.message)
      ),
    "Supabase must reject a sign-in email that omits the configured CAPTCHA token",
  );
  pass("Supabase enforces CAPTCHA before an authentication email is sent");

  if (runSmtpProbe) {
    const smtpEmail = `delivered+smtp-${runId}@resend.dev`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(smtpEmail, {
      redirectTo: `${origin}/auth/confirm`,
      data: { display_name: "YOVA release SMTP canary" },
    });
    if (data.user?.id) smtpProbeUserId = data.user.id;
    assert(!error && smtpProbeUserId, "Supabase SMTP did not accept the release-test invitation");
    pass("Supabase SMTP accepted an invitation through Resend's delivered test address");
  }

  const canaryEmail = `release-canary-${runId}@resend.dev`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: canaryEmail,
    email_confirm: true,
    user_metadata: { display_name: "YOVA release canary" },
  });
  assert(!createError && created.user, "Supabase could not create the isolated canary account");
  canaryUserId = created.user.id;
  pass("isolated verified account was created");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: canaryEmail,
    options: { redirectTo: origin },
  });
  const tokenHash = link.properties?.hashed_token;
  assert(!linkError && tokenHash, "Supabase could not mint a one-time canary sign-in token");

  const cookieJar = new Map();
  const signedIn = createServerClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: true },
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.value) cookieJar.set(cookie.name, cookie.value);
          else cookieJar.delete(cookie.name);
        }
      },
    },
  });
  const { data: verified, error: verifyError } = await signedIn.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  assert(
    !verifyError && verified.user?.id === canaryUserId && verified.session,
    "the one-time sign-in token did not open the expected account",
  );
  pass("real token verification created an authenticated session");

  const tokenReplay = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data: replayed, error: replayError } = await tokenReplay.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  assert(
    replayError
      && !replayed.session
      && Number(replayError.status) >= 400
      && Number(replayError.status) < 500
      && /otp_expired|token[^\n]*(expired|invalid|used)|already[^\n]*used/i.test(
        `${replayError.code ?? ""} ${replayError.message}`,
      ),
    "the already-used sign-in token unexpectedly opened a second session",
  );
  pass("the production authentication provider rejected one-time token reuse");

  sessionCookie = [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  assert(sessionCookie, "the authenticated session did not produce server-readable cookies");

  const { error: profileSaveError } = await signedIn.rpc("save_learner_profile", {
    payload: {
      expectedAccountId: canaryUserId,
      displayName: "YOVA release canary verified",
      onboardingCompletedAt: new Date().toISOString(),
      commonBlocker: "release_canary",
      guidancePreference: "release_canary",
      preferredSessionMin: 20,
      preferredSessionMax: 30,
      explanationPreference: "release_canary",
      focusFrequency: "release_canary",
      startingPattern: "release_canary",
      energyWindow: "release_canary",
      primaryImprovementGoal: "release_canary",
      additionalContext: "{}",
    },
  });
  const [profileResult, learnerProfileResult] = await Promise.all([
    signedIn
      .from("profiles")
      .select("id,display_name,onboarding_completed_at")
      .eq("id", canaryUserId)
      .single(),
    signedIn
      .from("learner_profiles")
      .select("user_id,common_blocker,preferred_session_min,preferred_session_max")
      .eq("user_id", canaryUserId)
      .single(),
  ]);
  assert(
    !profileSaveError
      && !profileResult.error
      && !learnerProfileResult.error
      && profileResult.data?.id === canaryUserId
      && profileResult.data.display_name === "YOVA release canary verified"
      && learnerProfileResult.data?.user_id === canaryUserId
      && learnerProfileResult.data.common_blocker === "release_canary"
      && learnerProfileResult.data.preferred_session_min === 20
      && learnerProfileResult.data.preferred_session_max === 30,
    "bounded authenticated profile persistence or ownership reads failed",
  );
  pass("authenticated profile and learner settings persisted through the bounded RPC");

  const rejectedMaterialId = crypto.randomUUID();
  const { error: directInsertError } = await signedIn.from("material_uploads").insert({
    id: rejectedMaterialId,
    user_id: canaryUserId,
    filename: "untrusted-direct-write.txt",
    storage_path: `${canaryUserId}/${rejectedMaterialId}/material.txt`,
    mime_type: "text/plain",
    byte_size: 1,
    processing_status: "processing",
    metadata: {},
  });
  assert(
    directInsertError
      && /42501|permission|privilege|row-level security/i.test(
        `${directInsertError.code ?? ""} ${directInsertError.message}`,
      ),
    "authenticated direct table writes did not fail at the bounded permission boundary",
  );
  pass("Supabase rejected an authenticated direct material-table write");

  rejectedStoragePath = `${canaryUserId}/${crypto.randomUUID()}/material.txt`;
  const { error: directStorageError } = await signedIn.storage
    .from("learning-materials")
    .upload(rejectedStoragePath, new Blob(["x"], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
    });
  assert(
    directStorageError
      && /403|unauthori|permission|row-level security/i.test(
        `${directStorageError.statusCode ?? ""} ${directStorageError.error ?? ""} ${directStorageError.message}`,
      ),
    "authenticated Storage did not reject an unstaged object at its permission boundary",
  );
  pass("Supabase rejected an authenticated unstaged private-file write");

  const allowance = await fetch(`${origin}/api/sessions/allowance`, {
    headers: { Cookie: sessionCookie },
    cache: "no-store",
  });
  const allowanceBody = await allowance.json().catch(() => null);
  assert(
    allowance.ok && ["available", "temporarily_limited", "exhausted"].includes(allowanceBody?.status),
    `signed-in allowance check returned ${allowance.status}`,
  );
  pass("the deployed server authenticated the canary and read durable AI usage state");

  const staged = await requestJson(`${origin}/api/materials`, {
    method: "POST",
    cookie: sessionCookie,
    body: { name: "release-canary.txt", mimeType: "text/plain", sizeBytes: 64 },
  });
  stagedMaterialId = typeof staged.body?.materialId === "string"
    ? staged.body.materialId
    : null;
  stagedMaterialStoragePath = typeof staged.body?.storagePath === "string"
    ? staged.body.storagePath
    : null;
  assert(
    staged.response.ok
      && stagedMaterialId
      && stagedMaterialStoragePath
      && typeof staged.body?.token === "string",
    `material staging returned ${staged.response.status}`,
  );
  pass("material staging passed the deployed database quota boundary");

  const stagedBytes = new Blob(["x".repeat(64)], { type: "text/plain" });
  const { error: stagedUploadError } = await signedIn.storage
    .from("learning-materials")
    .uploadToSignedUrl(stagedMaterialStoragePath, staged.body.token, stagedBytes, {
      contentType: "text/plain",
    });
  assert(!stagedUploadError, "the exact staged private-file upload failed");
  pass("the exact staged private file crossed the bounded Storage policy");

  const removedMaterial = await requestJson(`${origin}/api/materials`, {
    method: "DELETE",
    cookie: sessionCookie,
    body: { materialId: stagedMaterialId },
  });
  assert(removedMaterial.response.status === 204, `material cleanup returned ${removedMaterial.response.status}`);
  stagedMaterialId = null;
  const { data: removedObject, error: removedObjectError } = await admin.storage
    .from("learning-materials")
    .download(stagedMaterialStoragePath);
  assert(removedObjectError && !removedObject, "the cancelled staged file remained downloadable");
  stagedMaterialStoragePath = null;
  pass("the staged material row and private object were removed cleanly");

  const deviceState = {
    schemaVersion: 1,
    accountId: canaryUserId,
    capturedAt: new Date().toISOString(),
    previewSnapshot: null,
    pendingSessionCompletions: [],
    pendingSessionInterruptions: [],
    activeSessionCheckpoints: [],
  };
  const startedExport = await requestJson(`${origin}/api/account/data-export`, {
    method: "POST",
    cookie: sessionCookie,
    origin,
    headers: { "X-Yova-Data-Export": "account-data" },
    body: { deviceState },
  });
  exportId = typeof startedExport.body?.exportId === "string"
    ? startedExport.body.exportId
    : null;
  assert(
    startedExport.response.ok && exportId && startedExport.body?.finalizeGrant,
    `account-export preparation returned ${startedExport.response.status}`,
  );

  const finalizedExport = await requestJson(`${origin}/api/account/data-export`, {
    method: "PUT",
    cookie: sessionCookie,
    origin,
    headers: { "X-Yova-Data-Export": "account-data" },
    body: {
      exportId,
      finalizeGrant: startedExport.body.finalizeGrant,
    },
  });
  assert(
    finalizedExport.response.ok && typeof finalizedExport.body?.downloadUrl === "string",
    `account-export finalization returned ${finalizedExport.response.status}`,
  );
  const exportDownloadUrl = finalizedExport.body.downloadUrl;
  const downloadedExport = await fetch(exportDownloadUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const downloadedBody = await downloadedExport.json().catch(() => null);
  assert(
    downloadedExport.ok
      && downloadedBody?.schemaVersion === 1
      && downloadedBody?.product === "YOVA"
      && downloadedBody?.account?.id === canaryUserId
      && downloadedBody?.account?.email === canaryEmail
      && downloadedBody?.cloudData?.schemaVersion === 1
      && downloadedBody?.cloudData?.profile?.displayName === "YOVA release canary verified"
      && downloadedBody?.cloudData?.learnerProfile?.commonBlocker === "release_canary"
      && Number.isSafeInteger(downloadedBody?.cloudData?.recordCount)
      && downloadedBody.cloudData.recordCount >= 2
      && Array.isArray(downloadedBody?.cloudData?.learningItems)
      && Array.isArray(downloadedBody?.cloudData?.plans)
      && downloadedBody?.deviceState?.accountId === canaryUserId
      && downloadedBody?.exportScope?.originalMaterialFilesIncluded === false
      && downloadedBody?.exportScope?.passwordIncluded === false
      && downloadedBody?.exportScope?.signInTokensIncluded === false,
    `the private export download returned ${downloadedExport.status}`,
  );
  pass("private account export contained the expected cloud, device, and scope records");

  const replayedFinalize = await requestJson(`${origin}/api/account/data-export`, {
    method: "PUT",
    cookie: sessionCookie,
    origin,
    headers: { "X-Yova-Data-Export": "account-data" },
    body: {
      exportId,
      finalizeGrant: startedExport.body.finalizeGrant,
    },
  });
  assert(
    replayedFinalize.response.status === 409,
    `a consumed export finalization grant returned ${replayedFinalize.response.status}`,
  );
  pass("the production export finalization grant was one-time use");

  const revokedExport = await requestJson(`${origin}/api/account/data-export`, {
    method: "DELETE",
    cookie: sessionCookie,
    origin,
    headers: { "X-Yova-Data-Export": "account-data" },
    body: { exportId },
  });
  assert(revokedExport.response.status === 204, `account-export revocation returned ${revokedExport.response.status}`);
  const revokedDownload = await fetch(exportDownloadUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert(
    [400, 404].includes(revokedDownload.status),
    `the revoked private export URL returned ${revokedDownload.status}`,
  );
  exportId = null;
  pass("the private export was revoked and its signed URL stopped serving data");

  deletionLearningStoragePath = `${canaryUserId}/${crypto.randomUUID()}/deletion-sentinel.txt`;
  deletionExportStoragePath = `${canaryUserId}/${crypto.randomUUID()}/deletion-sentinel.json`;
  const [learningSentinel, exportSentinel] = await Promise.all([
    admin.storage.from("learning-materials").upload(
      deletionLearningStoragePath,
      new Blob(["delete me"], { type: "text/plain" }),
      { contentType: "text/plain", upsert: false },
    ),
    admin.storage.from("account-exports").upload(
      deletionExportStoragePath,
      new Blob(["{\"delete\":true}"], { type: "application/json" }),
      { contentType: "application/json", upsert: false },
    ),
  ]);
  assert(
    !learningSentinel.error && !exportSentinel.error,
    "the canary could not seed private objects for account-deletion cleanup proof",
  );
  pass("private Storage sentinels were seeded for the account-deletion route");

  const deletedAccount = await requestJson(`${origin}/api/account`, {
    method: "DELETE",
    cookie: sessionCookie,
    origin,
    headers: { "X-Yova-Confirm": "delete-account" },
    body: { accountId: canaryUserId, confirmation: "DELETE" },
  });
  assert(deletedAccount.response.status === 204, `account deletion returned ${deletedAccount.response.status}`);

  const { data: deletedIdentity, error: deletedIdentityError } = await admin.auth.admin
    .getUserById(canaryUserId);
  assert(
    deletedIdentityError
      && !deletedIdentity?.user
      && (
        deletedIdentityError.status === 404
        || deletedIdentityError.code === "user_not_found"
      )
      && /not found/i.test(deletedIdentityError.message),
    "the account-deletion route returned success while the Auth identity still existed",
  );
  await assertNoAccountRows(admin, canaryUserId, [
    ["profiles", "id"],
    ["learner_profiles", "user_id"],
    ["material_uploads", "user_id"],
    ["learning_items", "user_id"],
    ["plans", "user_id"],
    ["ai_usage_windows", "user_id"],
  ]);
  const [deletedLearningSentinel, deletedExportSentinel, learningObjects, exportObjects] = await Promise.all([
    admin.storage.from("learning-materials").download(deletionLearningStoragePath),
    admin.storage.from("account-exports").download(deletionExportStoragePath),
    admin.storage.from("learning-materials").list(canaryUserId, { limit: 100 }),
    admin.storage.from("account-exports").list(canaryUserId, { limit: 100 }),
  ]);
  assert(
    deletedLearningSentinel.error
      && !deletedLearningSentinel.data
      && deletedExportSentinel.error
      && !deletedExportSentinel.data
      && !learningObjects.error
      && !exportObjects.error
      && learningObjects.data.length === 0
      && exportObjects.data.length === 0,
    "private Storage still contained canary objects after account deletion",
  );
  deletionLearningStoragePath = null;
  deletionExportStoragePath = null;
  accountDeletedByYova = true;
  pass("YOVA removed the Auth identity, owned database rows, and private files");

  console.log("All automatable production account-lifecycle checks passed.");
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : "production lifecycle canary failed"}`);
  process.exitCode = 1;
} finally {
  if (canaryUserId && sessionCookie && stagedMaterialId) {
    await recordHttpCleanup(
      "staged material receipt",
      () => requestJson(`${origin}/api/materials`, {
        method: "DELETE",
        cookie: sessionCookie,
        body: { materialId: stagedMaterialId },
      }),
      [202, 204],
      cleanupFailures,
    );
  }
  if (canaryUserId && sessionCookie && exportId) {
    await recordHttpCleanup(
      "account-export receipt",
      () => requestJson(`${origin}/api/account/data-export`, {
        method: "DELETE",
        cookie: sessionCookie,
        origin,
        headers: { "X-Yova-Data-Export": "account-data" },
        body: { exportId },
      }),
      [204],
      cleanupFailures,
    );
  }
  if (smtpProbeUserId) {
    await recordCleanup(
      "SMTP probe identity",
      () => admin.auth.admin.deleteUser(smtpProbeUserId),
      cleanupFailures,
    );
  }
  if (canaryUserId) {
    const learningPaths = [
      stagedMaterialStoragePath,
      rejectedStoragePath,
      deletionLearningStoragePath,
    ].filter(Boolean);
    if (learningPaths.length > 0) {
      await recordCleanup(
        "learning-material objects",
        () => admin.storage.from("learning-materials").remove(learningPaths),
        cleanupFailures,
      );
    }
    const exportPaths = [
      deletionExportStoragePath,
      ...(exportId
        ? [
          `${canaryUserId}/${exportId}/device-state.json`,
          `${canaryUserId}/${exportId}/yova-data.json`,
        ]
        : []),
    ].filter(Boolean);
    if (exportPaths.length > 0) {
      await recordCleanup(
        "account-export objects",
        () => admin.storage.from("account-exports").remove(exportPaths),
        cleanupFailures,
      );
    }
  }
  if (canaryUserId && !accountDeletedByYova) {
    await recordCleanup(
      "canary identity",
      () => admin.auth.admin.deleteUser(canaryUserId),
      cleanupFailures,
    );
  }
  if (cleanupFailures.length > 0) {
    for (const failure of cleanupFailures) console.error(`FAIL  Cleanup failed for ${failure}`);
    process.exitCode = 1;
  }
}

function productionOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

async function requestJson(url, { method, cookie, origin: requestOrigin, headers = {}, body }) {
  return readJson(url, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(requestOrigin
        ? { Origin: requestOrigin, "Sec-Fetch-Site": "same-origin" }
        : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = response.status === 204
    ? null
    : await response.json().catch(() => null);
  return { response, body };
}

async function assertNoAccountRows(client, accountId, inventories) {
  for (const [table, ownerColumn] of inventories) {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(ownerColumn, accountId);
    assert(!error && count === 0, `${table} retained rows for the deleted canary account`);
  }
}

async function recordCleanup(label, cleanup, failures) {
  try {
    const result = await cleanup();
    if (result?.error) failures.push(`${label}: ${result.error.message ?? "unknown provider error"}`);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : "unexpected exception"}`);
  }
}

async function recordHttpCleanup(label, cleanup, acceptedStatuses, failures) {
  try {
    const result = await cleanup();
    if (!acceptedStatuses.includes(result?.response?.status)) {
      failures.push(`${label}: HTTP ${result?.response?.status ?? "unknown"}`);
    }
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : "unexpected exception"}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(message) {
  console.log(`PASS  ${message}`);
}
