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

export type RelationshipType = "lender_panel" | "aggregator" | "association_membership";
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
