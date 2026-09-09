/**
 * The REAL API client, talking to the NestJS backend built in Epics 2-4 — separate
 * from api-client.ts, which stays mocked and backs the reviewer/business screens that
 * aren't wired up yet. Keeping these two files apart means finishing that wiring later
 * is additive (swap one file's imports at a time), not a rewrite of this one.
 *
 * Covers the register -> login -> profile flow (AUTH-001/002, ONB-* from
 * src/modules/brokers/brokers.controller.ts) and business creation via ABN lookup
 * (ONB-014/BUS-024, src/modules/businesses/businesses.controller.ts).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

// Decoded client-side for UI convenience only (e.g. knowing which org id to pass to
// /accreditations/queue) — never trusted for authorization, the backend re-validates
// the real token's signature on every request regardless.
export function getClientOrganisationIdFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { clientOrganisationId?: string };
    return payload.clientOrganisationId ?? null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = typeof data?.message === "string" ? data.message : res.statusText;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

// ---- auth (AUTH-001/002) ----

export type RegisterInput = { firstName: string; lastName: string; email: string; password: string };
export function registerBroker(input: RegisterInput): Promise<{ id: string }> {
  return apiFetch("/auth/broker/register", { method: "POST", body: JSON.stringify(input) });
}

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
export function loginBroker(email: string, password: string): Promise<TokenPair> {
  return apiFetch("/auth/broker/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

// ---- broker profile (ONB-*) ----

export type Address = { line1: string; line2?: string; city: string; postcode: string; state: string };

export type BrokerProfile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  date_of_birth: string | null;
  gender: string | null;
  phone_number: string | null;
  mobile_number: string | null;
  address: Address | null;
  postal_address: Address | null;
  right_to_work_status: string | null;
  experience_years: string | null;
  licence_type_held: string | null;
  credit_licence_number: string | null;
  credit_representative_number: string | null;
  licensing_entity_name: string | null;
  licensing_entity_number: string | null;
  status: string;
  attested_terms_at: string | null;
  created_at: string;
  updated_at: string;
};

export function getMyProfile(token: string): Promise<BrokerProfile> {
  return apiFetch("/brokers/me", { token });
}

export function updateMyProfile(token: string, patch: Record<string, unknown>): Promise<{ ok: true }> {
  return apiFetch("/brokers/me", { method: "PATCH", token, body: JSON.stringify(patch) });
}

export type OutstandingItem = { field: string; reason: string };
export function getOutstandingItems(token: string): Promise<OutstandingItem[]> {
  return apiFetch("/brokers/me/outstanding-items", { token });
}

export function attestTerms(token: string): Promise<{ ok: true }> {
  return apiFetch("/brokers/me/attest-terms", { method: "POST", token });
}

export function submitProfile(token: string): Promise<{ ok: true }> {
  return apiFetch("/brokers/me/submit", { method: "POST", token });
}

export type AssociationMembership = {
  id: string;
  association_name: string;
  membership_number: string;
  status: string;
  confirmed_by_association: boolean;
  created_at: string;
};

export function listAssociationMemberships(token: string): Promise<AssociationMembership[]> {
  return apiFetch("/brokers/me/associations", { token });
}

export function addAssociationMembership(
  token: string,
  input: { associationName: string; membershipNumber: string },
): Promise<{ id: string }> {
  return apiFetch("/brokers/me/associations", { method: "POST", token, body: JSON.stringify(input) });
}

export function removeAssociationMembership(token: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/brokers/me/associations/${id}`, { method: "DELETE", token });
}

// ---- business (BUS-*, ONB-014/BUS-024) ----

export type AbnLookupOutcome =
  | { status: "found"; result: AbnLookupResult }
  | { status: "not_found" }
  | { status: "invalid_abn" }
  | { status: "invalid_guid" }
  | { status: "not_configured" }
  | { status: "error"; detail: string };

export type AbnLookupResult = {
  abn: string;
  abnStatus: string;
  acn: string | null;
  entityName: string | null;
  entityTypeCode: string | null;
  entityTypeName: string | null;
  businessNames: string[];
  gstRegistered: boolean;
  addressState: string | null;
  addressPostcode: string | null;
};

// Never throws on a bad/unconfigured lookup — the backend always returns 200 with a
// status field precisely so the UI can fall back to manual entry either way (see
// businesses.controller.ts's `lookup` handler comment).
export function lookupAbn(token: string, abn: string): Promise<AbnLookupOutcome> {
  return apiFetch(`/businesses/lookup?abn=${encodeURIComponent(abn)}`, { token });
}

export type BusinessSearchResult = {
  platformMatches: Array<{ id: string; entity_type: string; legal_name: string; trading_name: string | null; status: string }>;
  registryMatch: AbnLookupResult | null;
};

export function searchBusinesses(token: string, abn: string): Promise<BusinessSearchResult> {
  return apiFetch(`/businesses/search?abn=${encodeURIComponent(abn)}`, { token });
}

export type CreateBusinessInput = {
  entityType: string;
  legalName?: string;
  tradingName?: string;
  abn?: string;
  acn?: string;
  gstRegistered?: boolean;
  trusteeName?: string;
  businessEmail?: string;
  address?: { line1: string; line2?: string; city: string; postcode: string; state: string };
};

export function createBusiness(token: string, input: CreateBusinessInput): Promise<{ id: string }> {
  return apiFetch("/businesses", { method: "POST", token, body: JSON.stringify(input) });
}

export type MyAffiliation = {
  id: string;
  broker_business_id: string;
  role: string;
  status: string;
  legal_name: string | null;
  trading_name: string | null;
  entity_type: string | null;
};

export function listMyAffiliations(token: string): Promise<MyAffiliation[]> {
  return apiFetch("/businesses/me/affiliations", { token });
}

// ---- client_user auth (AUTH-002/006 — MFA is mandatory, never optional) ----

export type MfaLoginPending = { pendingToken: string; tokenType: "mfa_pending" | "mfa_enrolment_pending" };
export function loginClientUser(email: string, password: string): Promise<MfaLoginPending> {
  return apiFetch("/auth/client/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export type MfaEnrolmentStart = { otpauthUri: string; secret: string; backupCodes: string[] };
export function beginClientMfaEnrolment(pendingToken: string): Promise<MfaEnrolmentStart> {
  return apiFetch("/auth/client/mfa/enroll", { method: "POST", token: pendingToken });
}

export function confirmClientMfaEnrolment(pendingToken: string, code: string): Promise<TokenPair> {
  return apiFetch("/auth/client/mfa/enroll/confirm", { method: "POST", token: pendingToken, body: JSON.stringify({ code }) });
}

export function verifyClientMfa(pendingToken: string, code: string): Promise<TokenPair> {
  return apiFetch("/auth/client/mfa/verify", { method: "POST", token: pendingToken, body: JSON.stringify({ code }) });
}

// ---- relationships (REL-001-007/010, src/modules/relationships) ----

export type RelationshipType = "lender_panel" | "aggregator_membership" | "association_membership";
export type RelationshipStatus = "requested" | "pending_acceptance" | "active" | "declined" | "revoked" | "ended";

export type MyRelationship = {
  id: string;
  broker_profile_id: string;
  client_organisation_id: string;
  type: RelationshipType;
  status: RelationshipStatus;
  shared_data_scope: string;
  consented_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  end_reason: string | null;
  created_at: string;
  client_organisation_name: string | null;
  client_organisation_type: string | null;
};

export type OrganisationRelationship = {
  id: string;
  broker_profile_id: string;
  client_organisation_id: string;
  type: RelationshipType;
  status: RelationshipStatus;
  shared_data_scope: string;
  consented_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  end_reason: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

// broker actor
export function listMyRelationships(token: string): Promise<MyRelationship[]> {
  return apiFetch("/relationships/me", { token });
}

export function acceptInvitation(token: string, id: string, consentVersion: string): Promise<{ ok: true }> {
  return apiFetch(`/relationships/${id}/accept`, { method: "POST", token, body: JSON.stringify({ consentVersion }) });
}

export function declineInvitation(token: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/relationships/${id}/decline`, { method: "POST", token });
}

export function revokeRelationship(token: string, id: string, reason?: string): Promise<{ ok: true }> {
  return apiFetch(`/relationships/${id}/revoke`, { method: "POST", token, body: JSON.stringify({ reason }) });
}

// client_user actor
export function listOrganisationRelationships(token: string): Promise<OrganisationRelationship[]> {
  return apiFetch("/relationships/organisation", { token });
}

export function inviteBroker(token: string, brokerEmail: string, type: RelationshipType): Promise<{ id: string }> {
  return apiFetch("/relationships/invitations", { method: "POST", token, body: JSON.stringify({ brokerEmail, type }) });
}

export function endRelationship(token: string, id: string, reason: string): Promise<{ ok: true }> {
  return apiFetch(`/relationships/${id}/end`, { method: "POST", token, body: JSON.stringify({ reason }) });
}

// ---- accreditation (ACR-*/REV-*, src/modules/accreditation) ----

export type AccreditationClassification = "new_broker_introducer" | "new_referrer_introducer" | "transfer" | "add_on";
export type AccreditationStatus =
  | "requested"
  | "information_required"
  | "exception_escalated"
  | "declined"
  | "pending"
  | "party_changed_pending"
  | "active"
  | "lapsed";
export type LicenceHolderType = "aggregator_organisation" | "broking_business" | "third_party";

export type Accreditation = {
  id: string;
  lender_client_organisation_id: string;
  broker_profile_id: string;
  broker_business_id: string;
  classification: AccreditationClassification;
  brand: string;
  role: string;
  product_scope: string;
  pathway: string;
  ruleset_version_id: string | null;
  licence_holder_type: LicenceHolderType;
  lender_issued_id: string | null;
  status: AccreditationStatus;
  current_decision_step: "reviewer" | "senior_approver";
  interview_recommendation: string | null;
  party_changed_at: string | null;
  training_deadline_at: string | null;
  activated_at: string | null;
  requested_at: string;
  decided_at: string | null;
  created_at: string;
};

export type AccreditationDecision = {
  id: string;
  accreditation_id: string;
  actor_type: string;
  actor_id: string | null;
  decision_type: "information_requested" | "escalated" | "approved" | "declined" | "interview_recorded";
  rationale: string | null;
  itemised_reasons: string[] | null;
  created_at: string;
};

export type AccreditationFullContext = {
  accreditation: Accreditation;
  profile: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
  evidence: Array<{ id: string; document_type: string | null; expiry_date: string | null; original_filename: string | null }>;
  checkResults: Array<{ check_type: string; outcome: string }>;
  decisions: AccreditationDecision[];
};

export type OutstandingRequirement = { groupId: string; label: string; reason: string };
export type OutstandingItemsResult = { rulesetConfigured: true; items: OutstandingRequirement[] } | { rulesetConfigured: false };

export type RequestAccreditationInput = {
  lenderClientOrganisationId: string;
  brokerBusinessId: string;
  classification: AccreditationClassification;
  brand: string;
  role: string;
  productScope: string;
  licenceHolderType: LicenceHolderType;
  licenceHolderClientOrganisationId?: string;
  licenceHolderBrokerBusinessId?: string;
  licenceHolderName?: string;
  isCorporateCreditRepresentative?: boolean;
};

export function requestAccreditation(token: string, input: RequestAccreditationInput): Promise<{ id: string }> {
  return apiFetch("/accreditations", { method: "POST", token, body: JSON.stringify(input) });
}

export function listMyAccreditations(token: string): Promise<Accreditation[]> {
  return apiFetch("/accreditations/me", { token });
}

export function listAccreditationQueue(
  token: string,
  lenderClientOrganisationId: string,
  filters: { status?: AccreditationStatus; classification?: AccreditationClassification; productScope?: string } = {},
): Promise<Accreditation[]> {
  const params = new URLSearchParams({ lenderClientOrganisationId, ...filters } as Record<string, string>);
  return apiFetch(`/accreditations/queue?${params.toString()}`, { token });
}

export function getAccreditation(token: string, id: string): Promise<AccreditationFullContext> {
  return apiFetch(`/accreditations/${id}`, { token });
}

export function getAccreditationOutstandingItems(token: string, id: string): Promise<OutstandingItemsResult> {
  return apiFetch(`/accreditations/${id}/outstanding-items`, { token });
}

export function requestAccreditationInformation(token: string, id: string, itemisedReasons: string[]): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${id}/request-information`, { method: "POST", token, body: JSON.stringify({ itemisedReasons }) });
}

export function escalateAccreditation(token: string, id: string, rationale?: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${id}/escalate`, { method: "POST", token, body: JSON.stringify({ rationale }) });
}

export function approveAccreditation(token: string, id: string, rationale?: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${id}/approve`, { method: "POST", token, body: JSON.stringify({ rationale }) });
}

export function declineAccreditation(token: string, id: string, rationale: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${id}/decline`, { method: "POST", token, body: JSON.stringify({ rationale }) });
}

export function recordInterview(token: string, id: string, recommendation: string, notes?: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${id}/interview`, { method: "POST", token, body: JSON.stringify({ recommendation, notes }) });
}

export function checkAccreditationLapse(token: string, lenderClientOrganisationId: string): Promise<{ lapsedIds: string[] }> {
  const params = new URLSearchParams({ lenderClientOrganisationId });
  return apiFetch(`/accreditations/check-lapse?${params.toString()}`, { method: "POST", token });
}

// ---- training (TRN-*, confirmation not delivery — src/modules/accreditation/training.repository.ts) ----

export type TrainingKind = "platform" | "product";
export type TrainingConfirmation = {
  id: string;
  accreditation_id: string;
  kind: TrainingKind;
  confirmed_at: string;
  notes: string | null;
};

export function listTrainingConfirmations(token: string, accreditationId: string): Promise<TrainingConfirmation[]> {
  return apiFetch(`/accreditations/${accreditationId}/training-confirmations`, { token });
}

export function confirmTraining(token: string, accreditationId: string, kind: TrainingKind, notes?: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${accreditationId}/confirm-training`, { method: "POST", token, body: JSON.stringify({ kind, notes }) });
}

export function activateAccreditation(token: string, accreditationId: string): Promise<{ ok: true }> {
  return apiFetch(`/accreditations/${accreditationId}/activate`, { method: "POST", token });
}

// ---- notifications (NOT-*, src/modules/notifications) ----

export type Notification = {
  id: string;
  recipient_type: "broker" | "client_user";
  category: string;
  subject: string;
  body: string;
  suppressed: boolean;
  sent_at: string | null;
  created_at: string;
};

export type NotificationPreference = { category: string; enabled: boolean };

export function listMyNotifications(token: string): Promise<Notification[]> {
  return apiFetch("/notifications/me", { token });
}

export function getNotificationPreferences(token: string): Promise<NotificationPreference[]> {
  return apiFetch("/notification-preferences", { token });
}

export function setNotificationPreference(token: string, category: string, enabled: boolean): Promise<{ ok: true }> {
  return apiFetch("/notification-preferences", { method: "PATCH", token, body: JSON.stringify({ category, enabled }) });
}

export const NOTIFICATION_CATEGORIES = [
  "profile_submitted",
  "business_submitted",
  "accreditation_queue_entry",
  "accreditation_information_required",
  "accreditation_approved",
  "accreditation_declined",
  "accreditation_activated",
] as const;
export const MANDATORY_NOTIFICATION_CATEGORIES = new Set([
  "accreditation_information_required",
  "accreditation_approved",
  "accreditation_declined",
]);

// ---- Epic 13: broker profile self-service + audit surfacing ----

export type OutstandingSummaryItem = {
  source: "profile" | "business" | "accreditation";
  sourceId: string;
  sourceLabel: string;
  groupId: string;
  label: string;
  reason: string;
};
export function getOutstandingSummary(token: string): Promise<OutstandingSummaryItem[]> {
  return apiFetch("/brokers/me/outstanding-summary", { token });
}

export type AccessHistoryEntry = {
  occurred_at: string;
  organisation_name: string | null;
  document_type: string | null;
  original_filename: string | null;
};
export function listMyAccessHistory(token: string): Promise<AccessHistoryEntry[]> {
  return apiFetch("/brokers/me/access-history", { token });
}

export type Reconstruction = {
  asOf: string;
  accreditations: Array<{ id: string; brand: string; role: string; classification: string; status: string }>;
  checkResults: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
};
export function getReconstruction(token: string, asOf: string): Promise<Reconstruction> {
  return apiFetch(`/brokers/me/reconstruction?asOf=${encodeURIComponent(asOf)}`, { token });
}

/**
 * The first authenticated file download in this app — a plain <a href> can't carry
 * the Bearer token, so this fetches the blob with the header set, then triggers a
 * save via a synthetic anchor click. Also what makes AUD-007's access logging
 * (evidence.repository.ts's getDocumentForDownload) actually fire in practice —
 * before this there was no UI path that ever hit the download endpoint at all.
 */
export async function downloadDocument(token: string, evidenceId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${evidenceId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- token storage ----
// localStorage, deliberately simple — a real app would use httpOnly cookies + a
// refresh flow; this scope is "prove the API works end to end in a browser," not a
// production session-management design.

const TOKEN_KEY = "thriski_access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

// A separate key from the broker's — distinct actor types, so a browser session can
// hold both a broker and a client_user token at once without one clobbering the other.
const CLIENT_TOKEN_KEY = "thriski_client_access_token";

export function getStoredClientToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CLIENT_TOKEN_KEY);
}

export function storeClientToken(token: string): void {
  window.localStorage.setItem(CLIENT_TOKEN_KEY, token);
}

export function clearClientToken(): void {
  window.localStorage.removeItem(CLIENT_TOKEN_KEY);
}
