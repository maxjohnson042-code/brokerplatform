import type { BrokerProfileSummary } from "./types";

/**
 * Fixture data standing in for Epic 2's real HTTP API. Deliberately covers a spread
 * of statuses (verified/active, attention_required, in_verification, incomplete) so
 * every screen built against this data exercises more than the one happy-path status
 * — a reviewer queue that only ever renders "Active" rows in dev doesn't tell you
 * whether the warning/danger states actually look right until real data does it in
 * production. See lib/api-client.ts for where this gets swapped for real fetch calls.
 */
export const MOCK_BROKERS: BrokerProfileSummary[] = [
  {
    id: "b1a1a1a1-0000-4000-8000-000000000001",
    firstName: "Priya",
    lastName: "Nathan",
    email: "priya.nathan@example.com",
    status: "active",
    createdAt: "2026-06-02T01:00:00Z",
    business: {
      id: "biz-0001",
      legalName: "Nathan Finance Pty Ltd",
      status: "active",
    },
    outstandingItems: [],
    checks: [
      {
        id: "chk-1",
        checkType: "identity_verification_kyc",
        provider: "sumsub",
        outcome: "approved",
        completedAt: "2026-05-20T04:30:00Z",
        hasEvidence: true,
      },
      {
        id: "chk-2",
        checkType: "credit_representative_authorisation",
        provider: "manual",
        outcome: "current",
        completedAt: "2026-05-22T04:30:00Z",
        hasEvidence: true,
      },
    ],
  },
  {
    id: "b1a1a1a1-0000-4000-8000-000000000002",
    firstName: "Marcus",
    lastName: "Webb",
    email: "marcus.webb@example.com",
    status: "attention_required",
    createdAt: "2026-04-11T01:00:00Z",
    business: {
      id: "biz-0002",
      legalName: "Webb & Associates Broking",
      status: "attention_required",
    },
    outstandingItems: [
      {
        id: "oi-1",
        label: "Police certificate expiring",
        description: "Current certificate expires in 12 days — upload a renewed one to avoid a monitoring breach.",
      },
    ],
    checks: [
      {
        id: "chk-3",
        checkType: "identity_verification_kyc",
        provider: "sumsub",
        outcome: "approved",
        completedAt: "2026-01-14T04:30:00Z",
        hasEvidence: true,
      },
    ],
  },
  {
    id: "b1a1a1a1-0000-4000-8000-000000000003",
    firstName: "Aisha",
    lastName: "Okafor",
    email: "aisha.okafor@example.com",
    status: "in_verification",
    createdAt: "2026-08-20T01:00:00Z",
    outstandingItems: [
      { id: "oi-2", label: "Identity verification pending", description: "Submitted 2 days ago — awaiting Sumsub result." },
      { id: "oi-3", label: "Business affiliation required", description: "Link to a verified business, or start a new business onboarding, before accreditation can proceed." },
    ],
    checks: [],
  },
  {
    id: "b1a1a1a1-0000-4000-8000-000000000004",
    firstName: "Daniel",
    lastName: "Petrov",
    email: "daniel.petrov@example.com",
    status: "incomplete",
    createdAt: "2026-08-25T01:00:00Z",
    outstandingItems: [
      { id: "oi-4", label: "Association membership missing", description: "Add your MFAA or FBAA membership number to continue." },
      { id: "oi-5", label: "Professional indemnity certificate not uploaded", description: "Required before submission." },
    ],
    checks: [],
  },
];

export function findBroker(id: string): BrokerProfileSummary | undefined {
  return MOCK_BROKERS.find((b) => b.id === id);
}
