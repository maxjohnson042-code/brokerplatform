import { Injectable } from '@nestjs/common';
import { lookupAbn, AbnLookupOutcome } from './providers/abn-lookup.provider';

// Orchestration that isn't a DB operation lives here, not in businesses.repository.ts
// (which is specifically the withAuthorizationContext-governed DB boundary) — same
// split identity.module.ts established between identity.repository.ts and
// identity.service.ts in Epic 2.
@Injectable()
export class BusinessesService {
  lookupAbn(abn: string): Promise<AbnLookupOutcome> {
    return lookupAbn(abn);
  }
}
