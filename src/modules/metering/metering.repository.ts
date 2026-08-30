import { PoolClient } from 'pg';

export type MeteringEventType =
  | 'broker_linked'
  | 'broker_accredited'
  | 'broker_actively_monitored'
  | 'check_performed'
  | 'check_reused';

export type MeteringEvent = {
  clientOrganisationId: string;
  brokerProfileId: string;
  eventType: MeteringEventType;
  detail?: Record<string, unknown>;
};

/**
 * BIL-001: "every billable event emits an immutable metering record at the time it
 * occurs." Same pattern as audit.repository.ts — pass the PoolClient you already have
 * from withAuthorizationContext so this lands in the same transaction as the event
 * that triggered it (e.g. a relationship becoming active, or a check completing).
 *
 * billing_period is computed here rather than left to a later batch job, per
 * Section 1.1: "the platform must meter from day one... retrofitting billing
 * telemetry across an audit-bearing system is expensive and error-prone." The exact
 * counting rules for edge cases (a broker linked mid-period, linked to several
 * clients — OQ-10/BIL-005) are a policy decision for Epic 9, not a schema concern;
 * this function only needs to be called at the right moments.
 */
export async function recordMeteringEvent(client: PoolClient, event: MeteringEvent): Promise<void> {
  const billingPeriod = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  await client.query(
    `INSERT INTO metering_event
       (client_organisation_id, broker_profile_id, event_type, billing_period, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.clientOrganisationId,
      event.brokerProfileId,
      event.eventType,
      billingPeriod,
      JSON.stringify(event.detail ?? {}),
    ],
  );
}
