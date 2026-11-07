import policy from "../../config/verification.json";
import { verificationSchema, type Dataset, type Verification } from "../types";
export const verificationPolicy = policy;

const messages = {
  timeout: "Source verification timed out during the most recent check.",
  network: "The source could not be reached during the most recent check.",
  authorization: "The source requires authorization or refused access.",
  "missing-endpoint":
    "The source endpoint was not found during the most recent check.",
  http: "The source returned an unsuccessful HTTP response.",
  "invalid-response":
    "The source returned a response that could not be interpreted.",
  metadata: "The source did not provide the required metadata or layer schema.",
  unknown: "Source verification could not be completed successfully.",
};
export function verificationFailure(error: unknown) {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const httpStatus = Number(/HTTP (\d{3})\b/i.exec(text)?.[1]) || null;
  const errorType = classifyFailure(text, httpStatus);
  return { errorType, errorMessage: messages[errorType], httpStatus };
}
function classifyFailure(
  text: string,
  status: number | null,
): NonNullable<Verification["errorType"]> {
  if (/timeout|timed out|AbortError/i.test(text)) return "timeout";
  if (
    status === 401 ||
    status === 403 ||
    /token|authoriz|ArcGIS 49[89]/i.test(text)
  )
    return "authorization";
  if (status === 404 || status === 410) return "missing-endpoint";
  if (status) return "http";
  if (/network|fetch|offline|connection|cannot reach/i.test(text))
    return "network";
  if (/json|SyntaxError|malformed|CSV/i.test(text)) return "invalid-response";
  if (/schema|metadata|field|layer|endpoint|URL|resource/i.test(text))
    return "metadata";
  return "unknown";
}
function validDate(value: string | null | undefined, now: number) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now;
}
// Legacy timestamps originate in structural checks, never the curated date label.
export function completedVerification(
  dataset: Dataset,
  now = Date.now(),
): Verification | null {
  return dataset.verification
    ? persistedVerification(dataset.verification, now)
    : legacyVerification(dataset, now);
}
function persistedVerification(
  value: unknown,
  now: number,
): Verification | null {
  const parsed = verificationSchema.safeParse(value);
  if (!parsed.success || !validDate(parsed.data.lastCheckedAt, now))
    return null;
  const v = parsed.data;
  if (
    v.lastSuccessfulAt &&
    (!validDate(v.lastSuccessfulAt, now) ||
      Date.parse(v.lastSuccessfulAt) > Date.parse(v.lastCheckedAt))
  )
    return null;
  if (
    v.status === "verified" &&
    (Date.parse(v.lastSuccessfulAt ?? "") !== Date.parse(v.lastCheckedAt) ||
      v.errorType ||
      v.errorMessage)
  )
    return null;
  return v;
}
function legacyVerification(
  dataset: Dataset,
  now: number,
): Verification | null {
  if (dataset.verificationError && validDate(dataset.lastAttemptedAt, now)) {
    return {
      status: "failed",
      lastCheckedAt: dataset.lastAttemptedAt!,
      lastSuccessfulAt: validDate(dataset.lastVerifiedAt, now)
        ? dataset.lastVerifiedAt!
        : null,
      responseTimeMs: null,
      ...verificationFailure(dataset.verificationError),
    };
  }
  if (!validDate(dataset.lastVerifiedAt, now) || dataset.verificationError)
    return null;
  if (dataset.lastAttemptedAt && !validDate(dataset.lastAttemptedAt, now))
    return null;
  if (!dataset.fields?.length)
    return {
      status: "failed",
      lastCheckedAt: dataset.lastVerifiedAt!,
      lastSuccessfulAt: dataset.lastVerifiedAt!,
      httpStatus: null,
      responseTimeMs: null,
      errorType: "metadata",
      errorMessage: messages.metadata,
    };
  return {
    status: "verified",
    lastCheckedAt: dataset.lastVerifiedAt!,
    lastSuccessfulAt: dataset.lastVerifiedAt!,
    httpStatus: null,
    responseTimeMs: null,
    errorType: null,
    errorMessage: null,
  };
}
export function sourceStatus(dataset: Dataset, now = Date.now()) {
  const result = completedVerification(dataset, now);
  const stale =
    !!result &&
    now - Date.parse(result.lastCheckedAt) > policy.freshnessDays * 86400000;
  const state = !result
    ? "Not checked"
    : stale
      ? "Stale"
      : result.status === "failed"
        ? "Failed"
        : "Verified";
  return {
    state,
    result,
    stale,
    message: !result
      ? "Source has not yet been verified."
      : stale
        ? "Verification is outdated. Current availability is unknown."
        : result.status === "failed"
          ? messages[result.errorType ?? "unknown"]
          : "The source passed structural checks. This does not guarantee data accuracy, completeness or freshness.",
  };
}
export function publicFailureMessage(errorType: Verification["errorType"]) {
  return messages[errorType ?? "unknown"];
}
export function verificationDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const discoveryDiagnostics = new Set([
  "Portal search pagination repeated a cursor.",
  "Portal repeated a service item.",
  "Portal returned an empty page with further results.",
  "Publisher service returned no discoverable layers or tables.",
  "ArcGIS portals require an organization ID.",
]);
export function publicDiscoveryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (discoveryDiagnostics.has(message)) return message;
  if (message.startsWith("Unsupported geometry type:"))
    return "Unsupported source geometry.";
  const code = /^ArcGIS (\d{3}):/.exec(message)?.[1];
  const safe = verificationFailure(error).errorMessage;
  return code ? `ArcGIS ${code}: ${safe}` : safe;
}
