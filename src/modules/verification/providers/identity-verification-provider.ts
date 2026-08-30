/**
 * Section 21: "Provider adapters behind a common port. Each external source
 * implements the same interface: submit, poll or receive callback, normalise, and
 * return the raw payload untouched alongside the normalised result."
 *
 * This is that port for identity verification (IDV-*). Sumsub is the first
 * implementation (OQ-16 resolved); a second provider (IDV-014, Should-have) is a
 * second class implementing this same interface, never a change to calling code.
 */
export type VerificationSubject =
  | { kind: 'individual'; brokerProfileId: string; firstName: string; lastName: string; dateOfBirth?: string }
  | { kind: 'business'; brokerBusinessId: string; legalName: string; abn?: string };

export type VerificationSubmission = {
  providerApplicantId: string; // the provider's own reference — needed to poll/receive callbacks
};

export type VerificationResult = {
  status: 'pending' | 'approved' | 'declined' | 'requires_review';
  rawPayload: Buffer; // stored untouched as evidence — see evidence.repository.ts
  normalisedOutcome: string; // a derived convenience only — never a substitute (Section 2.4)
};

export interface IdentityVerificationProvider {
  submit(subject: VerificationSubject): Promise<VerificationSubmission>;
  poll(providerApplicantId: string): Promise<VerificationResult>;
}
