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
 * applicant, then generate a real external WebSDK link for it (IDV-015: use Sumsub's
 * own capture, don't build one).
 *
 * The hosted link comes from POST /resources/sdkIntegrations/levels/-/websdkLink
 * (https://docs.sumsub.com/reference/generate-websdk-external-link), NOT from
 * POST /resources/accessTokens — that access-token endpoint is for initializing the
 * embedded JS WebSDK client-side (snsWebSdk.init(token, ...)) and returns a token
 * that is never itself a browsable URL. An earlier version of this adapter
 * constructed a URL by hand from that access token (`${hostedLinkBaseUrl}/${token}`)
 * — it happened to look like a plausible /websdk/p/<token> URL but Sumsub returned a
 * real 404 for it, since it was never a real link in the first place. Found by
 * actually clicking "Start verification" in the browser, not by reading the docs
 * first — the constructed URL looked entirely legitimate.
 *
 * KYB (business) is deliberately NOT implemented here — see mock-kyb-adapter.ts.
 * Sumsub's KYB tier isn't provisioned on this account; when it is, KYB support is a
 * second `submit`/`poll` branch on this same class (or a second real adapter class),
 * never a change to anything that calls IdentityVerificationProvider.
 */
class SumsubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SumsubApiError';
  }
}

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
      throw new SumsubApiError(res.status, `Sumsub ${method} ${path} returned ${res.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async submit(subject: VerificationSubject): Promise<VerificationSubmission> {
    if (subject.kind !== 'individual') {
      throw new Error('SumsubAdapter only handles individual KYC — see mock-kyb-adapter.ts for business KYB.');
    }
    const externalUserId = subject.brokerProfileId;
    const levelName = env.sumsub.kycLevelName;

    // A retry (the broker abandons the hosted flow and clicks "Start verification"
    // again, or an earlier attempt failed after the applicant was created but before
    // the link was) hits this with an externalUserId that already has an applicant —
    // Sumsub enforces one applicant per externalUserId and returns 409, not an
    // idempotent create. Fall back to fetching the existing one rather than treating
    // this as a real failure.
    let applicant: { id: string };
    try {
      applicant = await this.request<{ id: string }>('POST', `/resources/applicants?levelName=${encodeURIComponent(levelName)}`, {
        externalUserId,
        info: { firstName: subject.firstName, lastName: subject.lastName, dob: subject.dateOfBirth },
      });
    } catch (err) {
      if (!(err instanceof SumsubApiError) || err.status !== 409) throw err;
      applicant = await this.request<{ id: string }>(
        'GET',
        `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`,
      );
    }

    // The real external-link endpoint — returns an actual browsable URL directly,
    // no manual construction. userId is the SAME externalUserId passed above, so
    // this link resolves to the applicant just created.
    const link = await this.request<{ url: string }>('POST', '/resources/sdkIntegrations/levels/-/websdkLink', {
      levelName,
      ttlInSecs: 1800,
      userId: externalUserId,
    });

    return {
      providerApplicantId: applicant.id,
      hostedLinkUrl: link.url,
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
