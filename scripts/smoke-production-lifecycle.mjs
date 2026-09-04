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
const smtpEmail = `delivered+smtp-${runId}@resend.dev`;
const canaryEmail = `release-canary-${runId}@resend.dev`;
const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

let smtpProbeUserId = null;
let canaryInviteId = null;
let canaryUserId = null;
let stagedMaterialId = null;
let stagedMaterialStoragePath = null;
let rejectedStoragePath = null;
let deletionLearningStoragePath = null;
let deletionExportStoragePath = null;
let exportId = null;
let exportRevoked = false;
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
  assert(
    ["invite-only", "open"].includes(status.body?.testerAccess),
    "testerAccess expected invite-only or open",
  );
  const inviteOnlyAccess = status.body.testerAccess === "invite-only";
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
    const { data, error } = await admin.auth.admin.inviteUserByEmail(smtpEmail, {
      redirectTo: `${origin}/auth/confirm`,
      data: { display_name: "YOVA release SMTP canary" },
    });
    if (data.user?.id) smtpProbeUserId = data.user.id;
    assert(!error && smtpProbeUserId, "Supabase SMTP did not accept the release-test invitation");
    pass("Supabase SMTP accepted an invitation through Resend's delivered test address");
  }

  let invitationJoinedByAuthTrigger = false;
  if (inviteOnlyAccess) {
    const { data: founder, error: founderError } = await admin
      .from("founder_accounts")
      .select("user_id")
      .order("created_at", { ascending: true })
      .order("user_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    assert(
      !founderError && founder?.user_id,
      "invite-only production needs an existing founder for the canary invitation",
    );

    // Allocate the compensating-cleanup key before the write so a lost response
    // cannot leave an otherwise successful insert behind.
    canaryInviteId = crypto.randomUUID();
    const { data: invite, error: inviteError } = await admin
      .from("tester_invites")
      .insert({
        id: canaryInviteId,
        email: canaryEmail,
        display_name: "YOVA release canary",
        invited_by: founder.user_id,
        status: "pending",
        send_count: 1,
        auth_user_id: null,
        joined_at: null,
      })
      .select("id,email,status,send_count,auth_user_id,joined_at")
      .single();
    assert(
      !inviteError
        && invite?.id === canaryInviteId
        && invite.email === canaryEmail
        && invite.status === "pending"
        && invite.send_count > 0
        && invite.auth_user_id === null
        && invite.joined_at === null,
      "the canary tester invitation was not durably created in a claimable pending state",
    );
    pass("a founder-backed pending tester invitation was created for the canary");
  }

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

  if (canaryInviteId) {
    const { data: pendingInvite, error: pendingInviteError } = await admin
      .from("tester_invites")
      .select("status,send_count,auth_user_id,joined_at")
      .eq("id", canaryInviteId)
      .single();
    const pendingForMiddleware = pendingInvite?.status === "pending"
      && pendingInvite.send_count > 0
      && pendingInvite.auth_user_id === null
      && pendingInvite.joined_at === null;
    const joinedByAuthTrigger = pendingInvite?.status === "joined"
      && pendingInvite.send_count > 0
      && pendingInvite.auth_user_id === canaryUserId
      && typeof pendingInvite.joined_at === "string";
    assert(
      !pendingInviteError
        && (pendingForMiddleware || joinedByAuthTrigger),
      "the tester invitation was neither pending nor validly joined to the canary account",
    );
    invitationJoinedByAuthTrigger = joinedByAuthTrigger;
    pass(
      invitationJoinedByAuthTrigger
        ? "the Auth confirmation trigger joined the tester invitation to the canary"
        : "the tester invitation remained pending for the deployed middleware",
    );
  }
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
  if (canaryInviteId) {
    const { data: claimedInvite, error: claimedInviteError } = await admin
      .from("tester_invites")
      .select("status,send_count,auth_user_id,joined_at")
      .eq("id", canaryInviteId)
      .single();
    assert(
      !claimedInviteError
        && claimedInvite?.status === "joined"
        && claimedInvite.send_count > 0
        && claimedInvite.auth_user_id === canaryUserId
        && typeof claimedInvite.joined_at === "string",
      "the tester invitation was not joined and bound after invite-only authentication",
    );
    pass(
      invitationJoinedByAuthTrigger
        ? "invite-only middleware accepted the Auth-trigger-joined tester invitation"
        : "invite-only middleware claimed the founder-backed tester invitation",
    );
  }

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
  const revokedExportFolder = `${canaryUserId}/${exportId}`;
  const { data: remainingExportObjects, error: remainingExportObjectsError } = await admin.storage
    .from("account-exports")
    .list(revokedExportFolder, { limit: 100 });
  assert(
    !remainingExportObjectsError && remainingExportObjects.length === 0,
    "the revoked private export remained at the Storage origin",
  );
  pass("the private export was removed from the Storage origin");

  const cacheMissUrl = new URL(exportDownloadUrl);
  cacheMissUrl.searchParams.set("cacheNonce", crypto.randomUUID());
  const cacheMissDownload = await fetch(cacheMissUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  await cacheMissDownload.body?.cancel().catch(() => undefined);
  assert(
    [400, 404].includes(cacheMissDownload.status),
    `a fresh cache-bypass request served the revoked export with status ${cacheMissDownload.status}`,
  );
  pass("a fresh CDN cache key could not retrieve the removed private export");

  const revokedDownloadStatus = await waitForSignedUrlInvalidation(exportDownloadUrl);
  assert(
    [400, 404].includes(revokedDownloadStatus),
    `the revoked private export URL returned ${revokedDownloadStatus} after the CDN invalidation window`,
  );
  exportRevoked = true;
  pass("the revoked signed URL stopped serving data across the CDN");

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
  if (canaryUserId && sessionCookie && exportId && !exportRevoked) {
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
      () => deleteAuthUserIfPresent(admin, smtpProbeUserId),
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
      () => deleteAuthUserIfPresent(admin, canaryUserId),
      cleanupFailures,
    );
  }
  await recordCleanup(
    "release-test identities by exact email",
    () => deleteAuthUsersByExactEmail(
      admin,
      runSmtpProbe ? [smtpEmail, canaryEmail] : [canaryEmail],
    ),
    cleanupFailures,
  );
  if (canaryUserId) {
    await recordCleanup(
      "release-test private Storage prefixes",
      () => verifyStoragePrefixesEmpty(admin, canaryUserId),
      cleanupFailures,
    );
  }
  if (canaryInviteId) {
    await recordCleanup(
      "canary tester invitation",
      () => deleteTesterInvite(admin, canaryInviteId),
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

async function waitForSignedUrlInvalidation(url, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let reportedPropagation = false;

  while (Date.now() < deadline) {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    lastStatus = response.status;
    await response.body?.cancel().catch(() => undefined);
    if ([400, 404].includes(lastStatus)) return lastStatus;
    if (lastStatus !== 200) return lastStatus;

    if (!reportedPropagation) {
      console.log("INFO  Waiting for Supabase's documented CDN deletion propagation window");
      reportedPropagation = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  return lastStatus;
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

async function deleteTesterInvite(client, inviteId) {
  const { error: deleteError } = await client
    .from("tester_invites")
    .delete()
    .eq("id", inviteId);
  if (deleteError) return { error: deleteError };

  const { count, error: verifyError } = await client
    .from("tester_invites")
    .select("id", { count: "exact", head: true })
    .eq("id", inviteId);
  if (verifyError) return { error: verifyError };
  return {
    error: count === 0 ? null : new Error("tester invitation remained after cleanup"),
  };
}

async function deleteAuthUserIfPresent(client, userId) {
  const existing = await client.auth.admin.getUserById(userId);
  if (isMissingAuthUserError(existing.error)) return { error: null };
  if (existing.error) return { error: existing.error };
  if (!existing.data?.user) return { error: null };

  const deleted = await client.auth.admin.deleteUser(userId);
  if (deleted.error && !isMissingAuthUserError(deleted.error)) {
    return { error: deleted.error };
  }

  const verified = await client.auth.admin.getUserById(userId);
  if (isMissingAuthUserError(verified.error)) return { error: null };
  if (verified.error) return { error: verified.error };
  return {
    error: verified.data?.user
      ? new Error(`Auth identity ${userId} remained after cleanup`)
      : null,
  };
}

async function deleteAuthUsersByExactEmail(client, emails) {
  const safeEmailPattern = /^(?:release-canary-|delivered\+smtp-)[a-z0-9-]+@resend\.dev$/i;
  if (!emails.every((email) => safeEmailPattern.test(email))) {
    return { error: new Error("refused unsafe release-test email cleanup") };
  }

  const expectedEmails = new Set(emails.map((email) => email.toLowerCase()));
  const matchedUserIds = new Set();
  const perPage = 1_000;
  let reachedEnd = false;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) return { error };
    const users = Array.isArray(data?.users) ? data.users : [];
    for (const user of users) {
      if (user.email && expectedEmails.has(user.email.toLowerCase())) {
        matchedUserIds.add(user.id);
      }
    }
    if (users.length < perPage) {
      reachedEnd = true;
      break;
    }
  }
  if (!reachedEnd) {
    return { error: new Error("could not prove the complete Auth cleanup inventory") };
  }

  for (const userId of matchedUserIds) {
    const result = await deleteAuthUserIfPresent(client, userId);
    if (result.error) return result;
  }
  return { error: null };
}

function isMissingAuthUserError(error) {
  return Boolean(
    error
      && (
        error.status === 404
        || error.code === "user_not_found"
        || /user not found/i.test(error.message ?? "")
      ),
  );
}

async function verifyStoragePrefixesEmpty(client, userId) {
  for (const bucket of ["learning-materials", "account-exports"]) {
    const { data, error } = await client.storage.from(bucket).list(userId, { limit: 1 });
    if (error) return { error };
    if (data.length > 0) {
      return { error: new Error(`${bucket} retained objects under the canary account prefix`) };
    }
  }
  return { error: null };
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
