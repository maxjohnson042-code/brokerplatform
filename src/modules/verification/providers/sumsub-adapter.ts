import { createHmac } from 'crypto';
import { env } from '../../../config/env';
import {
  IdentityVerificationProvider,
  VerificationResult,
  VerificationSubject,
  VerificationSubmission,
} from './identity-verification-provider';

/**
 * Sumsub adapter — OQ-16 resolved. This is a real request-signing implementation
 * (Sumsub's HMAC-SHA256 request signature scheme) wired against a STUBBED http call,
 * since this scaffold ships with no live Sumsub sandbox credentials. Replace the
 * `request()` body with an actual fetch/axios call once SUMSUB_APP_TOKEN and
 * SUMSUB_SECRET_KEY are set in .env, and this class's public shape should not need to
 * change — that is the point of building it behind IdentityVerificationProvider.
 *
 * Handles both KYC (individual) and KYB (business) subjects, per OQ-16's selection
 * criterion of a single provider covering both.
 */
export class SumsubAdapter implements IdentityVerificationProvider {
  private sign(method: string, path: string, body: string, ts: number): string {
    return createHmac('sha256', env.sumsub.secretKey)
      .update(ts + method.toUpperCase() + path + body)
      .digest('hex');
  }

  private async request(method: string, path: string, body: Record<string, unknown> = {}): Promise<Buffer> {
    const payload = Object.keys(body).length ? JSON.stringify(body) : '';
    const ts = Math.floor(Date.now() / 1000);
    const signature = this.sign(method, path, payload, ts);

    if (!env.sumsub.appToken || !env.sumsub.secretKey) {
      throw new Error(
        'SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY are not set. Add sandbox credentials to .env ' +
          '(see .env.example) before calling the Sumsub adapter for real — the request ' +
          'signing above is correct against Sumsub\'s documented scheme, only the ' +
          'transport call below is stubbed out.',
      );
    }

    // Deliberately not making a real network call in this scaffold. Wire in your
    // preferred HTTP client here — headers are exactly what Sumsub's API expects:
    //   X-App-Token: env.sumsub.appToken
    //   X-App-Access-Sig: signature
    //   X-App-Access-Ts: ts
    throw new Error(`Not implemented: ${method} ${path} (signature computed correctly: ${signature})`);
  }

  async submit(subject: VerificationSubject): Promise<VerificationSubmission> {
    const levelName = subject.kind === 'individual' ? 'basic-kyc-level' : 'basic-kyb-level';
    const externalUserId = subject.kind === 'individual' ? subject.brokerProfileId : subject.brokerBusinessId;

    await this.request('POST', `/resources/applicants?levelName=${levelName}`, {
      externalUserId,
      info:
        subject.kind === 'individual'
          ? { firstName: subject.firstName, lastName: subject.lastName, dob: subject.dateOfBirth }
          : { companyInfo: { companyName: subject.legalName, registrationNumber: subject.abn } },
    });

    // Real implementation returns Sumsub's applicantId from the response body.
    return { providerApplicantId: externalUserId };
  }

  async poll(providerApplicantId: string): Promise<VerificationResult> {
    const raw = await this.request('GET', `/resources/applicants/${providerApplicantId}/status`);
    return {
      status: 'pending',
      rawPayload: raw,
      normalisedOutcome: 'pending',
    };
  }
}
