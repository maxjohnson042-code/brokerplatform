/**
 * One-off: uploads a real logo for each of the 10 key lenders seeded by
 * seed-key-lenders.ts, using the exact same storage + branding write path as
 * client-organisation-admin.controller.ts's own POST /client-admin/organisation/logo
 * (defaultImageStorage.put, then updateClientOrganisationSetting(..., 'branding', ...)).
 * Run directly as 'system' rather than through that HTTP endpoint because none of
 * these 10 orgs have a client_admin login to authenticate as — they're name-only
 * placeholders (see seed-key-lenders.ts's own header comment).
 *
 * Source files live outside the repo (a local Downloads folder) and are read by
 * absolute path — this script is not meant to be portable/re-run on another machine,
 * just a record of how these logos were set, safe to re-run on this machine if a
 * logo file changes.
 *
 * Run with: npx ts-node scripts/upload-lender-logos.ts
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { updateClientOrganisationSetting } from '../src/modules/identity/identity.repository';
import { defaultImageStorage, extensionFor } from '../src/modules/media/image-storage';

const EXT_TO_MIME: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const LOGO_DIR = 'C:/Users/maxjo/Downloads/logos';
const LOGOS: Array<{ orgName: string; file: string }> = [
  { orgName: 'Commonwealth Bank', file: 'commonwealth-bank.png' },
  { orgName: 'ANZ', file: 'anz.png' },
  { orgName: 'Bankwest', file: 'bankwest-icon-filled-256.png' },
  { orgName: 'ING', file: 'ing logo.webp' },
  { orgName: 'NAB', file: 'nab.png' },
  { orgName: 'Pepper Money', file: 'pepper.png' },
  { orgName: 'St.George Bank', file: 'st-george-bank-vector-logo.png' },
  { orgName: 'Suncorp Bank', file: 'suncorp.com.png' },
  { orgName: 'Westpac', file: 'westpac.webp' },
  { orgName: 'Macquarie Bank', file: 'Macquarie_Group_logo.jpg' },
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
      console.log(`SKIP ${orgName}: no matching client_organisation — run seed-key-lenders.ts first.`);
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
