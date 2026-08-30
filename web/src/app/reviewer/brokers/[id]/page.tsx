import { notFound } from "next/navigation";
import { getBroker } from "@/lib/api-client";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckResultList } from "./check-result-list";

// Next.js 16: params is a Promise — see node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/dynamic-routes.md, read while building this scaffold
// because this project's Next version postdates this assistant's training data.
export default async function BrokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const broker = await getBroker(id);
  if (!broker) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {broker.firstName} {broker.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">{broker.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge domain="profile" value={broker.status} />
          <Button variant="outline" size="sm">Request more information</Button>
          <Button size="sm">Approve</Button>
        </div>
      </div>

      {/* REV-002: profile, documents and check results on one screen — this
          scaffold has profile + checks; documents (Epic 5) slots in as a third
          card in the same grid once DOC-001 exists. */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
          </CardHeader>
          <CardContent>
            {broker.business ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">{broker.business.legalName}</p>
                <StatusBadge domain="business" value={broker.business.status} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not yet affiliated with a business.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding items</CardTitle>
          </CardHeader>
          <CardContent>
            {broker.outstandingItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
            ) : (
              <ul className="space-y-3">
                {broker.outstandingItems.map((item) => (
                  <li key={item.id}>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Checks and evidence</h2>
        <CheckResultList checks={broker.checks} />
      </div>
    </div>
  );
}
