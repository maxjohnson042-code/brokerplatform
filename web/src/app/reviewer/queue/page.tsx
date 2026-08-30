import { listBrokers } from "@/lib/api-client";
import { QueueTable } from "./queue-table";

export default async function ReviewerQueuePage() {
  const brokers = await listBrokers();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reviewer queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        REV-001. Dense by design — a reviewer working a real panel needs to scan status at a glance,
        not click into every row.
      </p>
      <div className="mt-6">
        <QueueTable brokers={brokers} />
      </div>
    </div>
  );
}
