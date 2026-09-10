"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, UserX, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { getStatusMeta } from "@/lib/status";
import { requestedAgoLabel, trainingDeadlineLabel, daysUntil } from "@/lib/date-labels";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  getClientOrganisationIdFromToken,
  listOrganisationRelationships,
  listAccreditationQueue,
  type OrganisationRelationship,
  type QueueAccreditation,
} from "@/lib/thriski-api";

// Statuses that sit awaiting a lender decision with no deadline of their own — still
// genuinely "needs action," just not time-bound the way a pending accreditation's
// training_deadline_at is. Matches the plan's confirmed metric definition: these four
// PLUS pending rows whose training deadline falls within 7 days.
const AWAITING_DECISION_STATUSES = new Set(["requested", "information_required", "exception_escalated", "party_changed_pending"]);

// Sort priority for the "needs your attention" list — escalated/information-required
// first (already flagged as unusual), then plain awaiting-decision, then soon-lapsing
// training deadlines last (still real, but the least urgent of the three shapes).
const ATTENTION_RANK: Record<string, number> = {
  exception_escalated: 0,
  information_required: 1,
  party_changed_pending: 2,
  requested: 3,
  pending: 4,
};

type Data = {
  relationships: OrganisationRelationship[];
  accreditations: QueueAccreditation[];
};

type DeactivatedItem = {
  key: string;
  date: string;
  label: string;
  reason: string;
  href: string;
};

export function ClientDashboardView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string, orgId: string) => {
    const [relationships, accreditations] = await Promise.all([
      listOrganisationRelationships(activeToken),
      listAccreditationQueue(activeToken, orgId),
    ]);
    setData({ relationships, accreditations });
  }, []);

  useEffect(() => {
    const stored = getStoredClientToken();
    if (!stored) {
      router.replace("/client-login");
      return;
    }
    const orgId = getClientOrganisationIdFromToken(stored);
    if (!orgId) {
      router.replace("/client-login");
      return;
    }
    setToken(stored);
    refresh(stored, orgId).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearClientToken();
        router.replace("/client-login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load your dashboard.");
    });
  }, [router, refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data || !token) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
      </div>
    );
  }

  const { relationships, accreditations } = data;

  const activeRelationships = relationships.filter((r) => r.status === "active");
  const brokersOnPanel = new Set(activeRelationships.map((r) => r.broker_profile_id)).size;

  const needsActionAccreditations = accreditations.filter(
    (a) =>
      AWAITING_DECISION_STATUSES.has(a.status) ||
      (a.status === "pending" && !!a.training_deadline_at && daysUntil(a.training_deadline_at) <= 7),
  );

  const endedOrRevoked = relationships.filter((r) => r.status === "ended" || r.status === "revoked");
  const lapsedAccreditations = accreditations.filter((a) => a.status === "lapsed");
  const deactivatedOrLapsedCount = endedOrRevoked.length + lapsedAccreditations.length;

  const verificationBuckets = { verified: 0, inProgress: 0, attention: 0, other: 0 };
  for (const r of activeRelationships) {
    if (!r.broker_profile_status) continue;
    if (r.broker_profile_status === "verified") verificationBuckets.verified += 1;
    else {
      const meaning = getStatusMeta("profile", r.broker_profile_status).meaning;
      if (meaning === "warning" || meaning === "danger") verificationBuckets.attention += 1;
      else if (meaning === "info") verificationBuckets.inProgress += 1;
      else verificationBuckets.other += 1;
    }
  }

  const sortedNeedsAction = [...needsActionAccreditations]
    .sort((a, b) => {
      const rankDiff = (ATTENTION_RANK[a.status] ?? 9) - (ATTENTION_RANK[b.status] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      const aDeadline = a.training_deadline_at ? new Date(a.training_deadline_at).getTime() : Infinity;
      const bDeadline = b.training_deadline_at ? new Date(b.training_deadline_at).getTime() : Infinity;
      return aDeadline - bDeadline;
    })
    .slice(0, 5);

  const deactivatedItems: DeactivatedItem[] = [
    ...endedOrRevoked.map((r) => ({
      key: `rel-${r.id}`,
      date: r.effective_to ?? r.created_at,
      label: r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : r.email ?? "Broker",
      reason: r.end_reason ?? (r.status === "revoked" ? "Revoked by broker" : "Ended"),
      href: `/client/brokers/${r.broker_profile_id}`,
    })),
    ...lapsedAccreditations.map((a) => ({
      key: `acc-${a.id}`,
      date: a.training_deadline_at ?? a.requested_at,
      label: a.broker_first_name && a.broker_last_name ? `${a.broker_first_name} ${a.broker_last_name}` : "Unnamed broker",
      reason: "Accreditation lapsed",
      href: `/client/accreditations/${a.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lender dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">An overview of your broker panel.</p>
      </div>

      <div className="mb-6 grid gap-6 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <Users className="h-8 w-8 shrink-0 text-primary" />
            <div>
              <p className="text-2xl font-semibold text-foreground">{brokersOnPanel}</p>
              <p className="text-xs text-muted-foreground">Brokers on panel</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <AlertTriangle className="h-8 w-8 shrink-0 text-status-warning-fg" />
            <div>
              <p className="text-2xl font-semibold text-foreground">{needsActionAccreditations.length}</p>
              <p className="text-xs text-muted-foreground">Need action in the next 7 days</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <UserX className="h-8 w-8 shrink-0 text-status-danger-fg" />
            <div>
              <p className="text-2xl font-semibold text-foreground">{deactivatedOrLapsedCount}</p>
              <p className="text-xs text-muted-foreground">
                {endedOrRevoked.length} ended/revoked · {lapsedAccreditations.length} lapsed
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
            <CardDescription>Awaiting your review, or training due soon.</CardDescription>
          </CardHeader>
          <CardContent>
            {sortedNeedsAction.length === 0 ? (
              <p className="text-sm text-status-success-fg">Nothing outstanding.</p>
            ) : (
              <ul className="space-y-2">
                {sortedNeedsAction.map((a) => {
                  const brokerName = a.broker_first_name && a.broker_last_name ? `${a.broker_first_name} ${a.broker_last_name}` : "Unnamed broker";
                  const training = a.status === "pending" && a.training_deadline_at ? trainingDeadlineLabel(a.training_deadline_at) : null;
                  return (
                    <li key={a.id}>
                      <Link
                        href={`/client/accreditations/${a.id}`}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        <div>
                          <p className="text-foreground">{brokerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.business_legal_name ?? "Unnamed business"}
                            {training && <span className={training.overdue ? "font-medium text-status-danger-fg" : undefined}> · {training.label}</span>}
                            {!training && ` · ${requestedAgoLabel(a.requested_at)}`}
                          </p>
                        </div>
                        <StatusBadge domain="accreditation" value={a.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/client/queue" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              View full queue →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently deactivated / lapsed</CardTitle>
            <CardDescription>Relationships that ended, and lapsed accreditations.</CardDescription>
          </CardHeader>
          <CardContent>
            {deactivatedItems.length === 0 ? (
              <p className="text-sm text-status-success-fg">None.</p>
            ) : (
              <ul className="space-y-2">
                {deactivatedItems.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                    >
                      <div>
                        <p className="text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.reason}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString()}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/client/relationships" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              View broker panel →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Verification status</CardTitle>
          <CardDescription>Across {activeRelationships.length} active broker{activeRelationships.length === 1 ? "" : "s"}.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <p className="text-lg font-semibold text-status-success-fg">{verificationBuckets.verified}</p>
              <p className="text-xs text-muted-foreground">Verified</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-status-info-fg">{verificationBuckets.inProgress}</p>
              <p className="text-xs text-muted-foreground">In progress</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-status-warning-fg">{verificationBuckets.attention}</p>
              <p className="text-xs text-muted-foreground">Needs attention</p>
            </div>
            {verificationBuckets.other > 0 && (
              <div>
                <p className="text-lg font-semibold text-muted-foreground">{verificationBuckets.other}</p>
                <p className="text-xs text-muted-foreground">Other</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
