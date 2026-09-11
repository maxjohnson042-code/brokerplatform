/**
 * One-off: uploads a real logo for each of the 10 key aggregators seeded by
 * seed-key-aggregators.ts — same pattern as upload-lender-logos.ts (defaultImageStorage
 * + updateClientOrganisationSetting, run directly as 'system' since none of these 10
 * orgs have a client_admin login to authenticate as).
 *
 * Source files live outside the repo (a local Downloads folder) and are read by
 * absolute path — not meant to be portable/re-run on another machine, just a record of
 * how these logos were set, safe to re-run on this machine if a logo file changes.
 *
 * Run with: npx ts-node scripts/upload-aggregator-logos.ts
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { updateClientOrganisationSetting } from '../src/modules/identity/identity.repository';
import { defaultImageStorage, extensionFor } from '../src/modules/media/image-storage';

const EXT_TO_MIME: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const LOGO_DIR = 'C:/Users/maxjo/Downloads/agg logos';
const LOGOS: Array<{ orgName: string; file: string }> = [
  { orgName: 'AFG (Australian Finance Group)', file: 'afg.png' },
  { orgName: 'Connective', file: 'connective.jpg' },
  { orgName: 'Loan Market', file: 'loan market.png' },
  { orgName: 'Finsure', file: 'finsure.png' },
  { orgName: 'PLAN Australia', file: 'plan.jpg' },
  { orgName: 'Choice Aggregation Services', file: 'choice-aggregation-services.jpg' },
  { orgName: 'Vow Financial', file: 'vow.webp' },
  { orgName: 'Mortgage Choice', file: 'mortgage choice.png' },
  { orgName: 'Astute Financial', file: 'Astute.jpg' },
  { orgName: 'Specialist Finance Group', file: 'images.png' },
];

async function findOrgByName(name: string): Promise<{ id: string; branding: Record<string, unknown> } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id, settings->'branding' AS branding FROM client_organisations WHERE name = $1`, [name]);
    if (!rows[0]) return null;
    return { id: rows[0].id as string, branding: (rows[0].branding as Record<string, unknown>) ?? {} };
  });
}

async function main() {
  for (const { orgName, file } of LOGOS) {
    const path = `${LOGO_DIR}/${file}`;
    if (!existsSync(path)) {
      console.log(`SKIP ${orgName}: file not found at ${path}`);
      continue;
    }
    const org = await findOrgByName(orgName);
    if (!org) {
      console.log(`SKIP ${orgName}: no matching client_organisation — run seed-key-aggregators.ts first.`);
      continue;
    }
    const ext = extname(file).toLowerCase();
    const mimeType = EXT_TO_MIME[ext];
    if (!mimeType) {
      console.log(`SKIP ${orgName}: unrecognised extension "${ext}".`);
      continue;
    }
    const buffer = readFileSync(path);
    const key = await defaultImageStorage.put(buffer, extensionFor(mimeType));
    const logoUrl = `/media/${key}`;
    await updateClientOrganisationSetting({ actorType: 'system' }, org.id, 'branding', { ...org.branding, logoUrl });
    console.log(`SET  ${orgName}: ${logoUrl}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
