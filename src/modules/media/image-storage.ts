/**
 * Storage for mutable, low-sensitivity visual assets (profile photos, org logos) —
 * deliberately separate from evidence/object-storage.ts, which enforces write-once
 * for compliance documents (Section 20.4). Images here are expected to be replaced
 * (a broker re-uploads a photo, a lender re-uploads a logo), so there is no
 * overwrite guard; each upload just gets a fresh random key, and the old blob is
 * simply orphaned rather than deleted — an acceptable dev-only tradeoff, matching
 * this file's own "do not ship" framing below.
 *
 * IMPORTANT — this is a DEV CONVENIENCE ONLY, same caveat as
 * evidence/object-storage.ts: a real deployment needs real object storage (S3/GCS/
 * Azure Blob) behind this same two-method interface, not a local directory.
 */
import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, extname, join } from 'path';

export interface ImageStorage {
  put(data: Buffer, extension: string): Promise<string>; // returns the storage key
  get(key: string): Promise<Buffer>;
}

export class LocalFilesystemImageStorage implements ImageStorage {
  constructor(private readonly rootDir: string = join(process.cwd(), 'var', 'image-store')) {}

  async put(data: Buffer, extension: string): Promise<string> {
    const key = `${randomUUID()}${extension}`;
    const path = join(this.rootDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFileSync(join(this.rootDir, key));
  }
}

export const defaultImageStorage = new LocalFilesystemImageStorage();

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function extensionFor(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? extname(mimeType);
}

export function mimeTypeForKey(key: string): string {
  const ext = extname(key).toLowerCase();
  const entry = Object.entries(MIME_TO_EXTENSION).find(([, e]) => e === ext);
  return entry?.[0] ?? 'application/octet-stream';
}
