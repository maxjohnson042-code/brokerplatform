import { randomUUID } from 'crypto';
import {
  IdentityVerificationProvider,
  VerificationResult,
  VerificationSubject,
  VerificationSubmission,
} from './identity-verification-provider';

/**
 * A stand-in for Sumsub's real KYB (business) product, which this account doesn't
 * have provisioned yet. Implements the SAME IdentityVerificationProvider interface
 * as SumsubAdapter — every caller (identity-verification.repository.ts) is written
 * against the interface, not this class, so swapping in a real KYB adapter later is
 * a one-file change: point the KYB branch at a new class, delete this one.
 *
 * Deliberately slow-ish and asynchronous-shaped (a short delay, a synthetic
 * applicantId) rather than instant, so the calling code's "pending, then a result
 * arrives" flow gets exercised the same way it would against a real provider. There
 * is no webhook for this adapter — recordWebhookResult never fires for KYB rows;
 * the orchestration layer calls poll() directly instead (see
 * identity-verification.repository.ts's initiateVerification for the kind==='business'
 * branch).
 */
export class MockKybAdapter implements IdentityVerificationProvider {
  async submit(subject: VerificationSubject): Promise<VerificationSubmission> {
    if (subject.kind !== 'business') {
      throw new Error('MockKybAdapter only handles business KYB — see sumsub-adapter.ts for individual KYC.');
    }
    return { providerApplicantId: `mock-kyb-${randomUUID()}` };
  }

  async poll(providerApplicantId: string): Promise<VerificationResult> {
    const rawPayload = {
      provider: 'mock-kyb',
      applicantId: providerApplicantId,
      reviewStatus: 'completed',
      reviewResult: { reviewAnswer: 'GREEN' },
      note: 'Fabricated result — this account has no real Sumsub KYB access. Replace MockKybAdapter with a real adapter once provisioned.',
      generatedAt: new Date().toISOString(),
    };
    return {
      status: 'approved',
      rawPayload: Buffer.from(JSON.stringify(rawPayload)),
      normalisedOutcome: 'GREEN',
    };
  }
}
