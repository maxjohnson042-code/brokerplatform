/**
 * The direct proof that Epic 9's engine is now live, not just unit-tested in
 * isolation: seeds one of Epic 9's real fixtures (NAB_COMMERCIAL_BROKER_NEW) against
 * a lender, requests an accreditation matching that exact key-tuple, and confirms the
 * accreditation's outstanding items reflect THAT ruleset's requirement groups — not
 * document-catalog.ts's hardcoded catalog, which has no 'experience_resume' concept
 * at all and would never produce this item.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { createDraft, publish } from '../../src/modules/rulesets/rulesets.repository';
import { NAB_COMMERCIAL_BROKER_NEW } from '../../src/modules/rulesets/seed-data/nab';
import { requestAccreditation, getOutstandingItems } from '../../src/modules/accreditation/accreditation.repository';

const systemCtx = { actorType: 'system' as const };

describe('accreditation outstanding items — Epic 9 ruleset integration', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('reflects the resolved ruleset\'s requirement groups, not document-catalog.ts\'s hardcoded catalog', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({
      email: `accr-ruleset-${suffix}@example.com`,
      password: 'dev-password-123456',
      firstName: 'Ruleset',
      lastName: 'Integration',
    });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };

    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Ruleset Integration Lender ${suffix}` });

    const draft = await createDraft(systemCtx, {
      clientOrganisationId: org.id,
      ...NAB_COMMERCIAL_BROKER_NEW.key,
      label: NAB_COMMERCIAL_BROKER_NEW.label,
      definition: NAB_COMMERCIAL_BROKER_NEW.definition,
    });
    await publish(systemCtx, draft.id);

    const business = await createBusiness(brokerCtx, broker.id, { entityType: 'company', legalName: `Ruleset Integration Co ${suffix}` });
    await requestRelationship(brokerCtx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const accreditation = await requestAccreditation(brokerCtx, {
      brokerProfileId: broker.id,
      lenderClientOrganisationId: org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer', // -> pathway 'new', matching the seeded key
      brand: NAB_COMMERCIAL_BROKER_NEW.key.brand,
      role: NAB_COMMERCIAL_BROKER_NEW.key.role,
      productScope: NAB_COMMERCIAL_BROKER_NEW.key.productScope,
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });

    const { rows } = await withAuthorizationContext(systemCtx, (client) =>
      client.query(`SELECT ruleset_version_id FROM accreditations WHERE id = $1`, [accreditation.id]),
    );
    expect(rows[0].ruleset_version_id).toBe(draft.id);

    const outstanding = await getOutstandingItems(brokerCtx, accreditation.id);
    expect(outstanding.rulesetConfigured).toBe(true);
    if (outstanding.rulesetConfigured) {
      expect(outstanding.items.map((i) => i.groupId)).toEqual(['experience_resume']);
      // The hardcoded document-catalog.ts entries have no place here at all.
      expect(outstanding.items.map((i) => i.groupId)).not.toContain('certificate_iv');
      expect(outstanding.items.map((i) => i.groupId)).not.toContain('police_check');
    }
  });

  it('an accreditation with no matching ruleset reports rulesetConfigured: false, not an empty item list', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({
      email: `accr-ruleset-unconfigured-${suffix}@example.com`,
      password: 'dev-password-123456',
      firstName: 'Unconfigured',
      lastName: 'Ruleset',
    });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Unconfigured Ruleset Lender ${suffix}` });
    const business = await createBusiness(brokerCtx, broker.id, { entityType: 'company', legalName: `Unconfigured Co ${suffix}` });
    await requestRelationship(brokerCtx, { brokerProfileId: broker.id, clientOrganisationId: org.id, type: 'lender_panel', consentVersion: 'v1' });

    const accreditation = await requestAccreditation(brokerCtx, {
      brokerProfileId: broker.id,
      lenderClientOrganisationId: org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'commercial',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });

    const outstanding = await getOutstandingItems(brokerCtx, accreditation.id);
    expect(outstanding.rulesetConfigured).toBe(false);
  });
});
