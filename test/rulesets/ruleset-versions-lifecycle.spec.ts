/**
 * Repository + RLS proof for ruleset_versions (migration 0023): create draft ->
 * publish -> a second publish for the same key-tuple supersedes the first -> resolve()
 * finds the current published version -> a client_user from a different organisation
 * gets nothing back (RLS proof, same style as every prior epic's isolation test) ->
 * write access is platform_admin/system only.
 */
import { randomUUID } from 'crypto';
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import {
  createDraft,
  publish,
  resolve,
  listForOrganisation,
  getById,
  RulesetNotFoundError,
  InvalidRulesetTransitionError,
} from '../../src/modules/rulesets/rulesets.repository';
import { RulesetDefinition } from '../../src/modules/rulesets/ruleset.types';

const systemCtx = { actorType: 'system' as const };
const platformAdminCtx = { actorType: 'platform_admin' as const, actorId: randomUUID() };

const MINIMAL_DEFINITION: RulesetDefinition = {
  requirementGroups: [
    {
      id: 'certificate_iv',
      label: 'Certificate IV',
      subjectType: 'broker_profile',
      appliesWhen: { op: 'always' },
      satisfiedBy: [{ kind: 'document', documentType: 'certificate_iv', label: 'Certificate IV', validityDays: null }],
    },
  ],
  thresholds: {},
  declarations: [],
  approvalRouting: null,
  training: null,
};

async function seedLender(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Ruleset Test Lender ${suffix}` });
  const user = await createClientUser(systemCtx, {
    clientOrganisationId: org.id,
    email: `ruleset-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    role: 'reviewer',
  });
  return { org, ctx: { actorType: 'client_user' as const, actorId: user.id, clientOrganisationId: org.id } };
}

describe('ruleset_versions lifecycle and RLS (migration 0023)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('create draft -> publish -> republish supersedes the prior published version -> resolve finds the current one', async () => {
    const suffix = Date.now().toString();
    const lender = await seedLender(`${suffix}-a`);
    const key = { clientOrganisationId: lender.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'new' };

    const v1 = await createDraft(platformAdminCtx, { ...key, label: 'v1', definition: MINIMAL_DEFINITION });
    await publish(platformAdminCtx, v1.id);

    const resolvedV1 = await resolve(platformAdminCtx, key);
    expect(resolvedV1?.id).toBe(v1.id);
    expect(resolvedV1?.status).toBe('published');

    const v2 = await createDraft(platformAdminCtx, { ...key, label: 'v2', definition: MINIMAL_DEFINITION });
    await publish(platformAdminCtx, v2.id);

    const resolvedV2 = await resolve(platformAdminCtx, key);
    expect(resolvedV2?.id).toBe(v2.id);
    expect(resolvedV2?.version_number).toBe(2);

    const oldV1 = await getById(platformAdminCtx, v1.id);
    expect(oldV1.status).toBe('superseded');
    expect(oldV1.superseded_by).toBe(v2.id);
  });

  it('publishing a non-draft version is rejected', async () => {
    const suffix = Date.now().toString();
    const lender = await seedLender(`${suffix}-b`);
    const key = { clientOrganisationId: lender.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'new' };

    const v1 = await createDraft(platformAdminCtx, { ...key, label: 'v1', definition: MINIMAL_DEFINITION });
    await publish(platformAdminCtx, v1.id);

    await expect(publish(platformAdminCtx, v1.id)).rejects.toThrow(InvalidRulesetTransitionError);
  });

  it('resolve() returns null for a key-tuple with no published version', async () => {
    const suffix = Date.now().toString();
    const lender = await seedLender(`${suffix}-c`);
    const key = { clientOrganisationId: lender.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'transfer' };

    const result = await resolve(platformAdminCtx, key);
    expect(result).toBeNull();
  });

  it('a client_user sees their own organisation\'s rulesets but not another organisation\'s', async () => {
    const suffix = Date.now().toString();
    const linked = await seedLender(`${suffix}-d-linked`);
    const stranger = await seedLender(`${suffix}-d-stranger`);
    const key = { clientOrganisationId: linked.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'new' };

    const v1 = await createDraft(platformAdminCtx, { ...key, label: 'v1', definition: MINIMAL_DEFINITION });
    await publish(platformAdminCtx, v1.id);

    const ownList = await listForOrganisation(linked.ctx, linked.org.id);
    expect(ownList.map((r) => r.id)).toContain(v1.id);

    await expect(getById(stranger.ctx, v1.id)).rejects.toThrow(RulesetNotFoundError);
  });

  it('a client_user cannot write — createDraft/publish are platform_admin/system only', async () => {
    const suffix = Date.now().toString();
    const lender = await seedLender(`${suffix}-e`);
    const key = { clientOrganisationId: lender.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'new' };

    await expect(createDraft(lender.ctx, { ...key, label: 'v1', definition: MINIMAL_DEFINITION })).rejects.toThrow();
  });

  it('publish rejects a malformed definition', async () => {
    const suffix = Date.now().toString();
    const lender = await seedLender(`${suffix}-f`);
    const key = { clientOrganisationId: lender.org.id, brand: 'default', role: 'default', productScope: 'default', pathway: 'new' };

    const malformed = { requirementGroups: 'not-an-array' } as unknown as RulesetDefinition;
    const v1 = await createDraft(platformAdminCtx, { ...key, label: 'bad', definition: malformed });
    await expect(publish(platformAdminCtx, v1.id)).rejects.toThrow('invalid ruleset definition');
  });
});
