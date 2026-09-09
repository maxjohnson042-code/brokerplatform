import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sumsub signs each webhook delivery with an HMAC over the exact raw request bytes,
 * carried in the X-Payload-Digest header — verified against the digest algorithm
 * configured for that webhook subscription in Sumsub's dashboard. Pure (secret/alg
 * passed in, not read from env internally) so it's directly testable without
 * mutating process.env around a module that's already been imported and cached —
 * same "factor the pure logic out" shape as computeDisparities/computeOutstandingItems.
 *
 * Uses the raw, unparsed body on purpose — Nest/Express's default JSON body-parsing
 * re-serializes the payload, which almost never produces byte-for-byte the same
 * string Sumsub actually signed (key ordering, whitespace). main.ts enables
 * `rawBody: true` specifically so `req.rawBody` is available for the caller to pass in.
 */
export function verifySumsubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  digestAlg = 'sha256',
): boolean {
  if (!signatureHeader || !secret) return false;

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = createHmac(digestAlg, secret).update(rawBody).digest();
    provided = Buffer.from(signatureHeader, 'hex');
  } catch {
    return false;
  }

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
