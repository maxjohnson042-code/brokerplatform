"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearToken,
  getStoredToken,
  listMyRelationships,
  acceptInvitation,
  declineInvitation,
  revokeRelationship,
  mediaUrl,
  type MyRelationship,
} from "@/lib/thriski-api";

const TYPE_LABELS: Record<string, string> = {
  lender_panel: "Lender panel",
  aggregator_membership: "Aggregator",
  association_membership: "Association membership",
};

// PRF-005: "who is my data shared with, and what can they see" — shared_data_scope
// itself (SHARED_DATA_SCOPE in relationships.repository.ts) is server-side only, so
// these descriptions are the frontend's own plain-English gloss on each value.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  lender_full: "Full profile, licensing, documents and accreditation history.",
  aggregator_full: "Full profile, licensing, documents and accreditation history, as your aggregator.",
  association_membership_only: "Membership status only — not your profile, documents or accreditation history.",
};

export function RelationshipsView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<MyRelationship[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeReasonById, setRevokeReasonById] = useState<Record<string, string>>({});

  const refresh = useCallback(async (activeToken: string) => {
    const rows = await listMyRelationships(activeToken);
    setRelationships(rows);
  }, []);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setToken(stored);
    refresh(stored).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : "Could not load your relationships.");
    });
  }, [router, refresh]);

  async function runAction(id: string, action: () => Promise<unknown>) {
    if (!token) return;
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      await refresh(token);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That action didn't go through — please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function onLogout() {
    clearToken();
    router.replace("/login");
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      </div>
    );
  }

  if (!relationships) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading your relationships…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your relationships</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            REL-005. Every lender, aggregator, or association you&apos;re linked to, and any invitation waiting on you.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onLogout}>
          Sign out
        </Button>
      </div>

      {actionError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {relationships.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No relationships yet. Once a lender invites you — or you request to join a panel — it&apos;ll show up here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {relationships.map((r) => {
            const busy = busyId === r.id;
            return (
              <Card key={r.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="flex items-center gap-3">
                    {r.client_organisation_logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(r.client_organisation_logo_url)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md border border-border object-contain bg-card"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground">
                        <Building2 className="h-4 w-4" />
                      </div>
                    )}
                    <div>
                      <CardTitle>{r.client_organisation_name ?? "Unknown organisation"}</CardTitle>
                      <CardDescription>
                        {TYPE_LABELS[r.type] ?? r.type}
                        {r.client_organisation_type ? ` · ${r.client_organisation_type}` : ""}
                      </CardDescription>
                    </div>
                  </div>
                  <StatusBadge domain="relationship" value={r.status} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">What they can see: </span>
                    {SCOPE_DESCRIPTIONS[r.shared_data_scope] ?? r.shared_data_scope}
                  </p>
                  {r.status === "pending_acceptance" && (
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => runAction(r.id, () => acceptInvitation(token!, r.id, "v1"))}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => runAction(r.id, () => declineInvitation(token!, r.id))}
                      >
                        Decline
                      </Button>
                    </div>
                  )}

                  {r.status === "active" && (
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        placeholder="Reason (optional)"
                        value={revokeReasonById[r.id] ?? ""}
                        onChange={(e) => setRevokeReasonById((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          runAction(r.id, () => revokeRelationship(token!, r.id, revokeReasonById[r.id] || undefined))
                        }
                      >
                        Revoke
                      </Button>
                    </div>
                  )}

                  {(r.status === "ended" || r.status === "revoked") && r.end_reason && (
                    <p className="text-xs text-muted-foreground">Reason: {r.end_reason}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
