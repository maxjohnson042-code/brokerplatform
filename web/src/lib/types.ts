/**
 * Mirrors the backend schema (see ../../../db/migrations and
 * ../../../src/modules/*) closely enough for the UI to be built against something
 * real, without importing the backend package directly (they're separate deployables
 * with their own release cadence — see README "Two packages, deliberately separate").
 * Keep this in sync by hand for now; a shared @thriski/contracts package generating
 * both the NestJS DTOs and these types from one source is worth doing once Epic 2's
 * HTTP layer exists and there's a real contract to share.
 */

export type ProfileStatus =
  | "draft"
  | "submitted"
  | "in_verification"
  | "verified"
  | "active"
  | "incomplete"
  | "attention_required"
  | "blacklisted"
  | "suspended"
  | "deactivated";

export type BusinessStatus =
  | "draft"
  | "submitted"
  | "in_verification"
  | "verified"
  | "active"
  | "incomplete"
  | "attention_required"
  | "breach"
  | "suspended"
  | "ceased";

export type OutstandingItem = {
  id: string;
  label: string;
  description: string;
};

export type CheckResultSummary = {
  id: string;
  checkType: string;
  provider: string;
  outcome: string;
  completedAt: string; // ISO
  hasEvidence: boolean;
};

export type BrokerBusinessSummary = {
  id: string;
  legalName: string;
  status: BusinessStatus;
};

export type BrokerProfileSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: ProfileStatus;
  createdAt: string; // ISO
  business?: BrokerBusinessSummary;
  outstandingItems: OutstandingItem[];
  checks: CheckResultSummary[];
};

export type RegisterBrokerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  experienceYears: number;
  addressLine1: string;
  city: string;
  state: string;
  postcode: string;
  attestedTerms: boolean;
};
