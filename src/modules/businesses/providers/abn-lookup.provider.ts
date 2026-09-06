import { env } from '../../../config/env';

/**
 * ONB-014/BUS-024 (Section 6.1a): "business data should be looked up, not typed."
 * Australia's ABN Lookup web service (abr.business.gov.au) — a free, public JSON
 * endpoint keyed by a self-registered GUID, not a paid/negotiated credential like
 * Sumsub. That means this adapter makes a REAL call whenever ABR_ABN_LOOKUP_GUID is
 * set, rather than being stubbed like sumsub-adapter.ts — there's no sandbox tier to
 * wait for. When it's unset, this returns an explicit 'not_configured' outcome and
 * never throws, so manual entry always works regardless.
 *
 * Endpoint, field names and error-signalling convention (a `Message` string rather
 * than a distinct error status) are drawn from a working reference implementation,
 * not guessed — see the outcome-mapping comment below.
 */

const ABR_BASE_URL = 'https://abr.business.gov.au/json/AbnDetails.aspx';

export type AbnLookupOutcome =
  | { status: 'found'; result: AbnLookupResult }
  | { status: 'not_found' }
  | { status: 'invalid_abn' } // failed local checksum validation — no network call made
  | { status: 'invalid_guid' }
  | { status: 'not_configured' }
  | { status: 'error'; detail: string };

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

// Australian Business Number checksum, per the ABR's published algorithm: subtract 1
// from the first digit, weight each of the 11 digits, sum, and check divisibility by
// 89. Run before any network call — an obviously malformed ABN shouldn't cost a
// request.
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbnChecksum(abn: string): boolean {
  const digits = abn.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weighted = digits.split('').map((d, i) => (i === 0 ? Number(d) - 1 : Number(d)) * ABN_WEIGHTS[i]);
  const sum = weighted.reduce((a, b) => a + b, 0);
  return sum % 89 === 0;
}

export async function lookupAbn(rawAbn: string): Promise<AbnLookupOutcome> {
  const digits = rawAbn.replace(/\s/g, '');
  if (!isValidAbnChecksum(digits)) return { status: 'invalid_abn' };
  if (!env.abrAbnLookup.guid) return { status: 'not_configured' };

  const url = `${ABR_BASE_URL}?abn=${encodeURIComponent(digits)}&guid=${encodeURIComponent(env.abrAbnLookup.guid)}&callback=callback`;

  let body: string;
  try {
    const response = await fetch(url);
    if (!response.ok) return { status: 'error', detail: `ABR responded ${response.status}` };
    body = await response.text();
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }

  // JSONP: "callback({...});" — unwrap before parsing, per the service's only response format.
  const match = /^\s*callback\((.*)\)\s*;?\s*$/s.exec(body);
  if (!match) return { status: 'error', detail: 'unexpected ABR response shape' };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { status: 'error', detail: 'could not parse ABR response' };
  }

  // ABR signals errors and not-found through a `Message` string rather than a
  // distinct HTTP status or error field — pattern-match it the same way a working
  // reference implementation against this exact service already does.
  const message = typeof parsed.Message === 'string' ? parsed.Message : '';
  if (message) {
    if (/no record found|abn not found/i.test(message)) return { status: 'not_found' };
    if (/guid.*not recognised|not a registered party/i.test(message)) return { status: 'invalid_guid' };
    return { status: 'error', detail: message };
  }

  const businessNames = Array.isArray(parsed.BusinessName)
    ? (parsed.BusinessName as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];

  return {
    status: 'found',
    result: {
      abn: String(parsed.Abn ?? digits),
      abnStatus: String(parsed.AbnStatus ?? ''),
      acn: parsed.Acn ? String(parsed.Acn) : null,
      entityName: parsed.EntityName ? String(parsed.EntityName) : null,
      entityTypeCode: parsed.EntityTypeCode ? String(parsed.EntityTypeCode) : null,
      entityTypeName: parsed.EntityTypeName ? String(parsed.EntityTypeName) : null,
      businessNames,
      gstRegistered: parsed.Gst === true || parsed.Gst === 'true',
      addressState: parsed.AddressState ? String(parsed.AddressState) : null,
      addressPostcode: parsed.AddressPostcode ? String(parsed.AddressPostcode) : null,
    },
  };
}
