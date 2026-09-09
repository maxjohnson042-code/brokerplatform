import { createHmac } from 'crypto';
import { env } from '../../../config/env';
import {
  IdentityVerificationProvider,
  VerificationResult,
  VerificationSubject,
  VerificationSubmission,
} from './identity-verification-provider';

/**
 * Sumsub adapter — OQ-16 resolved, KYC (individual) only. This scaffold's original
 * comment described the request-signing as real against a stubbed transport; the
 * transport is now real too. Handles the individual-KYC hosted-link flow: create an
 * applicant, then request a one-time access token and construct the hosted
 * verification link from it (IDV-015: use Sumsub's own capture, don't build one).
 *
 * KYB (business) is deliberately NOT implemented here — see mock-kyb-adapter.ts.
 * Sumsub's KYB tier isn't provisioned on this account; when it is, KYB support is a
 * second `submit`/`poll` branch on this same class (or a second real adapter class),
 * never a change to anything that calls IdentityVerificationProvider.
 */
export class SumsubAdapter implements IdentityVerificationProvider {
  private sign(method: string, path: string, body: string, ts: number): string {
    return createHmac('sha256', env.sumsub.secretKey)
      .update(ts + method.toUpperCase() + path + body)
      .digest('hex');
  }

  private async request<T>(method: string, path: string, body: Record<string, unknown> = {}): Promise<T> {
    if (!env.sumsub.appToken || !env.sumsub.secretKey) {
      throw new Error(
        'SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY are not set. Add sandbox credentials to .env (see .env.example) ' +
          'before calling the Sumsub adapter.',
      );
    }

    const payload = Object.keys(body).length ? JSON.stringify(body) : '';
    const ts = Math.floor(Date.now() / 1000);
    const signature = this.sign(method, path, payload, ts);

    const res = await fetch(`${env.sumsub.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': env.sumsub.appToken,
        'X-App-Access-Sig': signature,
        'X-App-Access-Ts': String(ts),
      },
      body: payload || undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Sumsub ${method} ${path} returned ${res.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async submit(subject: VerificationSubject): Promise<VerificationSubmission> {
    if (subject.kind !== 'individual') {
      throw new Error('SumsubAdapter only handles individual KYC — see mock-kyb-adapter.ts for business KYB.');
    }
    const externalUserId = subject.brokerProfileId;
    const levelName = env.sumsub.kycLevelName;

    const applicant = await this.request<{ id: string }>('POST', `/resources/applicants?levelName=${encodeURIComponent(levelName)}`, {
      externalUserId,
      info: { firstName: subject.firstName, lastName: subject.lastName, dob: subject.dateOfBirth },
    });

    // A one-time access token for the hosted verification flow — Sumsub's standard
    // "get a token for this user/level" endpoint, used for both the embedded WebSDK
    // and a hosted link. userId here is the SAME externalUserId passed above, per
    // Sumsub's documented pairing of the two calls.
    const accessToken = await this.request<{ token: string }>(
      'POST',
      `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}`,
    );

    return {
      providerApplicantId: applicant.id,
      hostedLinkUrl: `${env.sumsub.hostedLinkBaseUrl}/${encodeURIComponent(accessToken.token)}`,
    };
  }

  // A fallback for checking status without waiting for a webhook — the webhook
  // (see identity-verification.repository.ts's recordWebhookResult) is the primary
  // path for this epic, so this is here for completeness/manual use, not exercised
  // by the main flow.
  async poll(providerApplicantId: string): Promise<VerificationResult> {
    const raw = await this.request<{ reviewStatus?: string; reviewResult?: { reviewAnswer?: string } }>(
      'GET',
      `/resources/applicants/${providerApplicantId}/status`,
    );
    const reviewStatus = raw.reviewStatus ?? 'pending';
    const reviewAnswer = raw.reviewResult?.reviewAnswer;
    const status: VerificationResult['status'] =
      reviewStatus !== 'completed' ? 'pending' : reviewAnswer === 'GREEN' ? 'approved' : reviewAnswer === 'RED' ? 'declined' : 'requires_review';
    return {
      status,
      rawPayload: Buffer.from(JSON.stringify(raw)),
      normalisedOutcome: reviewAnswer ?? reviewStatus,
    };
  }
}
