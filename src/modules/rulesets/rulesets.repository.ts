import { randomUUID } from 'crypto';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { RulesetDefinition } from './ruleset.types';
import { validateRulesetDefinition } from './ruleset-validation';

export type RulesetVersionStatus = 'draft' | 'published' | 'superseded';

export type RulesetVersion = {
  id: string;
  client_organisation_id: string;
  brand: string;
  role: string;
  product_scope: string;
  pathway: string;
  version_number: number;
  label: string;
  status: RulesetVersionStatus;
  definition: RulesetDefinition;
  superseded_by: string | null;
  published_at: string | null;
  created_at: string;
};

export type RulesetKey = { clientOrganisationId: string; brand: string; role: string; productScope: string; pathway: string };

export class RulesetNotFoundError extends Error {
  constructor(id: string) {
    super(`ruleset version not found: ${id}`);
    this.name = 'RulesetNotFoundError';
  }
}
export class InvalidRulesetTransitionError extends Error {
  constructor(status: string) {
    super(`cannot publish a ruleset version while status is '${status}'`);
    this.name = 'InvalidRulesetTransitionError';
  }
}

// REL-adjacent naming avoided on purpose — this is Epic 9, not Epic 8. Draft only;
// publishing (and the supersede-the-prior-version step) is a separate call so a draft
// can be reviewed before it goes live, same "review before it's real" shape as
// document upload → outstanding-items rather than upload-is-final.
export async function createDraft(
  ctx: AuthorizationContext,
  input: RulesetKey & { label: string; definition: RulesetDefinition },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
       FROM ruleset_versions
       WHERE client_organisation_id = $1 AND brand = $2 AND role = $3 AND product_scope = $4 AND pathway = $5`,
      [input.clientOrganisationId, input.brand, input.role, input.productScope, input.pathway],
    );
    const versionNumber = rows[0].next;
    const id = randomUUID();

    await client.query(
      `INSERT INTO ruleset_versions
         (id, client_organisation_id, brand, role, product_scope, pathway, version_number, label, status, definition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9::jsonb)`,
      [
        id,
        input.clientOrganisationId,
        input.brand,
        input.role,
        input.productScope,
        input.pathway,
        versionNumber,
        input.label,
        JSON.stringify(input.definition),
      ],
    );

    await recordAuditEvent(client, {
      actorType: 'platform_admin',
      actorId: 'actorId' in ctx ? ctx.actorId : undefined,
      action: 'ruleset.created',
      subjectType: 'ruleset_version',
      subjectId: id,
      clientOrganisationId: input.clientOrganisationId,
      detail: { brand: input.brand, role: input.role, productScope: input.productScope, pathway: input.pathway, versionNumber },
    });

    return { id };
  });
}

// Validates the definition shape, flips any existing 'published' row for the same
// key-tuple to 'superseded' first (so the partial unique index on status='published'
// never sees two rows at once), then flips this row to 'published'. One transaction.
export async function publish(ctx: AuthorizationContext, id: string): Promise<void> {
  await withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<RulesetVersion>(`SELECT * FROM ruleset_versions WHERE id = $1`, [id]);
    const version = rows[0];
    if (!version) throw new RulesetNotFoundError(id);
    if (version.status !== 'draft') throw new InvalidRulesetTransitionError(version.status);

    validateRulesetDefinition(version.definition);

    const { rows: priorRows } = await client.query<{ id: string }>(
      `UPDATE ruleset_versions
       SET status = 'superseded', superseded_by = $1
       WHERE client_organisation_id = $2 AND brand = $3 AND role = $4 AND product_scope = $5 AND pathway = $6
         AND status = 'published'
       RETURNING id`,
      [id, version.client_organisation_id, version.brand, version.role, version.product_scope, version.pathway],
    );

    await client.query(`UPDATE ruleset_versions SET status = 'published', published_at = now() WHERE id = $1`, [id]);

    await recordAuditEvent(client, {
      actorType: 'platform_admin',
      actorId: 'actorId' in ctx ? ctx.actorId : undefined,
      action: 'ruleset.published',
      subjectType: 'ruleset_version',
      subjectId: id,
      clientOrganisationId: version.client_organisation_id,
      detail: { supersededVersionId: priorRows[0]?.id ?? null },
    });
  });
}

// Exact-match-or-nothing — no fuzzy/closest-match fallback. Guessing the "closest"
// ruleset is exactly the kind of rules-engine cleverness Section 23 forbids.
export async function resolve(ctx: AuthorizationContext, key: RulesetKey): Promise<RulesetVersion | null> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<RulesetVersion>(
      `SELECT * FROM ruleset_versions
       WHERE client_organisation_id = $1 AND brand = $2 AND role = $3 AND product_scope = $4 AND pathway = $5
         AND status = 'published'`,
      [key.clientOrganisationId, key.brand, key.role, key.productScope, key.pathway],
    );
    return rows[0] ?? null;
  });
}

export async function listForOrganisation(ctx: AuthorizationContext, clientOrganisationId: string): Promise<RulesetVersion[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<RulesetVersion>(
      `SELECT * FROM ruleset_versions WHERE client_organisation_id = $1 ORDER BY created_at DESC`,
      [clientOrganisationId],
    );
    return rows;
  });
}

export async function getById(ctx: AuthorizationContext, id: string): Promise<RulesetVersion> {
  const version = await withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<RulesetVersion>(`SELECT * FROM ruleset_versions WHERE id = $1`, [id]);
    return rows[0] ?? null;
  });
  if (!version) throw new RulesetNotFoundError(id);
  return version;
}
