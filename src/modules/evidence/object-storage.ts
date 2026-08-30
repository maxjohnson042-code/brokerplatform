/**
 * Section 20.4: "Provider payloads and artefacts go to object storage, not the
 * database. Metadata, hashes and pointers in Postgres." This interface is the seam —
 * swap LocalFilesystemObjectStorage for an S3/GCS/Azure Blob implementation behind
 * the same three methods when it's time to deploy anywhere but a laptop, without
 * touching evidence.repository.ts.
 *
 * IMPORTANT — this local implementation is a DEV CONVENIENCE ONLY and does not
 * satisfy Section 20.4's "write-once" requirement: a real deployment needs the
 * object-storage bucket configured with an object-lock / immutability policy so that
 * write-once is enforced by infrastructure, not application discipline. Do not ship
 * this adapter to any real environment.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

export class LocalFilesystemObjectStorage implements ObjectStorage {
  constructor(private readonly rootDir: string = join(process.cwd(), 'var', 'evidence-store')) {}

  async put(key: string, data: Buffer): Promise<void> {
    const path = join(this.rootDir, key);
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      throw new Error(
        `Refusing to overwrite existing evidence object at ${key} — evidence is write-once (Section 20.4).`,
      );
    }
    writeFileSync(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFileSync(join(this.rootDir, key));
  }
}
