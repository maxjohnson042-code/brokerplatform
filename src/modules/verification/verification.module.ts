import { Module } from '@nestjs/common';

// The check-orchestration job queue (Section 21: "model every check as a job, never a
// synchronous call in a request path" — requested -> in_flight -> completed | failed
// | timed_out, backed by Postgres SKIP LOCKED per Section 21) is the next piece to
// build here, once there's a second provider adapter to prove the port is generic
// enough. Epic 6/7 in the Release 1 backlog.
@Module({})
export class VerificationModule {}
