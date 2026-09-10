/**
 * Map view for addresses (UI polish) — free, keyless geocoding via OpenStreetMap's
 * Nominatim search API, proxied server-side rather than called from the browser:
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * requires a real identifying User-Agent and reasonable rate limiting, both easier to
 * guarantee from one server-side call site than from many browser tabs. Same
 * "fetch, normalise, never throw on a bad/empty result" shape as
 * abn-lookup.provider.ts.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'brok3r/0.1 (dev)';

export type GeocodeOutcome = { status: 'found'; lat: number; lon: number; displayName: string } | { status: 'not_found' } | { status: 'error'; detail: string };

export async function geocodeAddress(query: string): Promise<GeocodeOutcome> {
  if (!query.trim()) return { status: 'not_found' };

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
  let body: unknown;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return { status: 'error', detail: `Nominatim responded ${response.status}` };
    body = await response.json();
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }

  if (!Array.isArray(body) || body.length === 0) return { status: 'not_found' };
  const result = body[0] as { lat?: string; lon?: string; display_name?: string };
  if (!result.lat || !result.lon) return { status: 'not_found' };

  return { status: 'found', lat: parseFloat(result.lat), lon: parseFloat(result.lon), displayName: result.display_name ?? query };
}
