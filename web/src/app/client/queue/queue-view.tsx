"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  getClientOrganisationIdFromToken,
  listAccreditationQueue,
  checkAccreditationLapse,
  type QueueAccreditation,
  type AccreditationStatus,
} from "@/lib/thriski-api";

const STATUS_OPTIONS: { value: AccreditationStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "requested", label: "Requested" },
  { value: "information_required", label: "Information required" },
  { value: "exception_escalated", label: "Exception — escalated" },
  { value: "declined", label: "Declined" },
  { value: "pending", label: "Pending (training)" },
  { value: "active", label: "Active" },
  { value: "lapsed", label: "Lapsed" },
  { value: "party_changed_pending", label: "Party changed — pending" },
];

export function QueueView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueAccreditation[] | null>(null);
  const [status, setStatus] = useState<AccreditationStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [lapseMessage, setLapseMessage] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string, activeOrgId: string, statusFilter: AccreditationStatus | "") => {
    const rows = await listAccreditationQueue(activeToken, activeOrgId, statusFilter ? { status: statusFilter } : {});
    setQueue(rows);
  }, []);

  useEffect(() => {
    const stored = getStoredClientToken();
    if (!stored) {
      router.replace("/client-login");
      return;
    }
    const org = getClientOrganisationIdFromToken(stored);
    if (!org) {
      router.replace("/client-login");
      return;
    }
    setToken(stored);
    setOrgId(org);
    refresh(stored, org, status).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearClientToken();
        router.replace("/client-login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load the queue.");
    });
  }, [router, refresh, status]);

  async function onCheckLapse() {
    if (!token || !orgId) return;
    const { lapsedIds } = await checkAccreditationLapse(token, orgId);
    setLapseMessage(lapsedIds.length === 0 ? "Nothing overdue." : `${lapsedIds.length} accreditation(s) lapsed.`);
    await refresh(token, orgId, status);
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Review queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">REV-001. Filterable by status.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onCheckLapse}>
          Check for lapsed training deadlines
        </Button>
      </div>

      {lapseMessage && <p className="mb-4 text-sm text-muted-foreground">{lapseMessage}</p>}

      <div className="mb-4 w-56">
        <Select value={status} onChange={(e) => setStatus(e.target.value as AccreditationStatus | "")}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {!queue ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : queue.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nothing in the queue.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {queue.map((a) => {
            const brokerName = a.broker_first_name && a.broker_last_name ? `${a.broker_first_name} ${a.broker_last_name}` : null;
            return (
              <Card key={a.id} className="transition-colors hover:bg-muted/50">
                <Link href={`/client/accreditations/${a.id}`} className="block">
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle>{brokerName ?? "Unnamed broker"}</CardTitle>
                      <CardDescription>
                        {a.business_legal_name ?? "Unnamed business"}
                        {a.experience_years && ` · ${a.experience_years} yrs experience`}
                      </CardDescription>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {a.brand} — {a.role} · {a.classification.replace(/_/g, " ")} · {a.product_scope}
                      </p>
                    </div>
                    <StatusBadge domain="accreditation" value={a.status} />
                  </CardHeader>
                </Link>
                <CardContent className="pt-0">
                  <Link
                    href={`/client/brokers/${a.broker_profile_id}`}
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View broker profile
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
