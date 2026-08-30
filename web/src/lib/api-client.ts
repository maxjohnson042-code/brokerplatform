import { MOCK_BROKERS, findBroker } from "./mock-data";
import type { BrokerProfileSummary, RegisterBrokerInput } from "./types";

/**
 * The API boundary. Every screen imports FROM HERE, never from mock-data.ts
 * directly — so swapping mocks for the real Epic 2 HTTP endpoints is a change to
 * this one file, not a hunt through every page that fetches broker data.
 *
 * TODO(Epic 2): replace each function body with a fetch() against the NestJS API
 * once its HTTP controllers exist (the repository functions these will call —
 * registerBroker, getBrokerProfile — already exist in
 * ../../../src/modules/identity and ../../../src/modules/brokers). Keep the
 * function signatures stable; the reviewer-queue and broker-detail pages are
 * written against these signatures, not against the mock shape.
 */

const ARTIFICIAL_LATENCY_MS = 250; // stand-in for real network latency, so loading states are visible in dev

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ARTIFICIAL_LATENCY_MS));
}

export async function listBrokers(): Promise<BrokerProfileSummary[]> {
  return delay(MOCK_BROKERS);
}

export async function getBroker(id: string): Promise<BrokerProfileSummary | null> {
  return delay(findBroker(id) ?? null);
}

export async function registerBroker(
  // Unused until Epic 2's real endpoint exists — kept named and typed (rather than
  // dropped) so the mock's signature stays honest about what the real call will need.
  _input: RegisterBrokerInput,
): Promise<{ id: string }> {
  // Real implementation posts to POST /api/brokers/register (backed by
  // registerBroker() in src/modules/identity/identity.repository.ts).
  void _input;
  return delay({ id: "new-broker-id" });
}
