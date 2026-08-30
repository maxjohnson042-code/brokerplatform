/**
 * Single source of truth mapping every lifecycle status value in the master document
 * (Section 8, "Status models") to exactly one of five semantic meanings, and a
 * human-readable label. This is the design-system equivalent of the ruleset engine's
 * "two seeded rulesets" test (Section 23): if a new status value can't be slotted into
 * one of the five <StatusMeaning> buckets below without the UI looking wrong, that's a
 * sign the taxonomy needs revisiting — not a reason to invent a sixth colour.
 *
 * Components never choose a colour directly from a status string — they call
 * getStatusMeta(domain, value) and render whatever it returns. See
 * components/status-badge.tsx, and /design-system for every value below rendered.
 */
export type StatusMeaning = "success" | "warning" | "danger" | "info" | "neutral";

export type StatusDomain =
  | "profile" // Section 8.1
  | "business" // Section 8.2
  | "accreditation" // Section 8.3 — not yet built (Epic 10) but modelled now so the
  //                    taxonomy doesn't have to be revisited when it lands
  | "relationship" // migration 0004 — not in Section 8's list but the same shape
  | "monitoring"; // Section 8.5 — Release 2, modelled now for the same reason

export type StatusMeta = {
  label: string;
  meaning: StatusMeaning;
};

const PROFILE_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", meaning: "neutral" },
  submitted: { label: "Submitted", meaning: "info" },
  in_verification: { label: "In verification", meaning: "info" },
  verified: { label: "Verified", meaning: "success" },
  active: { label: "Active", meaning: "success" },
  incomplete: { label: "Incomplete", meaning: "warning" },
  attention_required: { label: "Attention required", meaning: "warning" },
  blacklisted: { label: "Blacklisted", meaning: "danger" },
  suspended: { label: "Suspended", meaning: "danger" },
  deactivated: { label: "Deactivated", meaning: "neutral" },
};

const BUSINESS_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", meaning: "neutral" },
  submitted: { label: "Submitted", meaning: "info" },
  in_verification: { label: "In verification", meaning: "info" },
  verified: { label: "Verified", meaning: "success" },
  active: { label: "Active", meaning: "success" },
  incomplete: { label: "Incomplete", meaning: "warning" },
  attention_required: { label: "Attention required", meaning: "warning" },
  breach: { label: "Breach", meaning: "danger" },
  suspended: { label: "Suspended", meaning: "danger" },
  ceased: { label: "Ceased", meaning: "neutral" },
};

const ACCREDITATION_STATUS: Record<string, StatusMeta> = {
  requested: { label: "Requested", meaning: "info" },
  in_review: { label: "In review", meaning: "info" },
  checks_in_progress: { label: "Checks in progress", meaning: "info" },
  approved: { label: "Approved", meaning: "success" },
  pending: { label: "Pending", meaning: "warning" },
  active: { label: "Active", meaning: "success" },
  information_required: { label: "Information required", meaning: "warning" },
  exception_escalated: { label: "Exception — escalated", meaning: "warning" },
  declined: { label: "Declined", meaning: "danger" },
  disputed: { label: "Disputed", meaning: "warning" },
  committee_review: { label: "Committee review", meaning: "info" },
  conditionally_active: { label: "Conditionally active", meaning: "warning" },
  under_review: { label: "Under review", meaning: "warning" },
  suspended: { label: "Suspended", meaning: "danger" },
  lapsed: { label: "Lapsed", meaning: "danger" },
  withdrawn: { label: "Withdrawn", meaning: "neutral" },
  ended: { label: "Ended", meaning: "neutral" },
  party_changed_pending: { label: "Party changed — pending re-acceptance", meaning: "warning" },
  suspended_blacklisted: { label: "Suspended — blacklisted", meaning: "danger" },
};

const RELATIONSHIP_STATUS: Record<string, StatusMeta> = {
  requested: { label: "Requested", meaning: "info" },
  pending_acceptance: { label: "Pending acceptance", meaning: "warning" },
  active: { label: "Active", meaning: "success" },
  declined: { label: "Declined", meaning: "danger" },
  revoked: { label: "Revoked", meaning: "danger" },
  ended: { label: "Ended", meaning: "neutral" },
};

const MONITORING_ITEM_STATUS: Record<string, StatusMeta> = {
  current: { label: "Current", meaning: "success" },
  due_soon: { label: "Due soon", meaning: "warning" },
  overdue: { label: "Overdue", meaning: "warning" },
  breached: { label: "Breached", meaning: "danger" },
  resolved: { label: "Resolved", meaning: "success" },
};

const REGISTRY: Record<StatusDomain, Record<string, StatusMeta>> = {
  profile: PROFILE_STATUS,
  business: BUSINESS_STATUS,
  accreditation: ACCREDITATION_STATUS,
  relationship: RELATIONSHIP_STATUS,
  monitoring: MONITORING_ITEM_STATUS,
};

export function getStatusMeta(domain: StatusDomain, value: string): StatusMeta {
  return (
    REGISTRY[domain][value] ?? {
      label: value,
      meaning: "neutral", // fail closed to the least alarming treatment, never invent a colour
    }
  );
}

export function allStatusesFor(domain: StatusDomain): Array<{ value: string } & StatusMeta> {
  return Object.entries(REGISTRY[domain]).map(([value, meta]) => ({ value, ...meta }));
}

export const STATUS_DOMAINS: StatusDomain[] = [
  "profile",
  "business",
  "accreditation",
  "relationship",
  "monitoring",
];
