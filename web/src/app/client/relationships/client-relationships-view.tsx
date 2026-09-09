"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  listOrganisationRelationships,
  inviteBroker,
  endRelationship,
  type OrganisationRelationship,
  type RelationshipType,
} from "@/lib/thriski-api";

const TYPES: { value: RelationshipType; label: string }[] = [
  { value: "lender_panel", label: "Lender panel" },
  { value: "aggregator", label: "Aggregator" },
  { value: "association_membership", label: "Association membership" },
];

export function ClientRelationshipsView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<OrganisationRelationship[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [endReasonById, setEndReasonById] = useState<Record<string, string>>({});

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteType, setInviteType] = useState<RelationshipType>("lender_panel");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);

  const refresh = useCallback(async (activeToken: string) => {
    const rows = await listOrganisationRelationships(activeToken);
    setRelationships(rows);
  }, []);

  useEffect(() => {
    const stored = getStoredClientToken();
    if (!stored) {
      router.replace("/client-login");
      return;
    }
    setToken(stored);
    refresh(stored).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearClientToken();
        router.replace("/client-login");
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : "Could not load relationships.");
    });
  }, [router, refresh]);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteSent(false);
    try {
      await inviteBroker(token, inviteEmail.trim(), inviteType);
      setInviteEmail("");
      setInviteSent(true);
      await refresh(token);
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.status === 404
          ? "No broker is registered with that email yet."
          : err instanceof ApiError
            ? err.message
            : "Could not send the invitation.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function onEnd(id: string) {
    if (!token) return;
    const reason = endReasonById[id]?.trim();
    if (!reason) {
      setActionError("A reason is required to end a relationship.");
      return;
    }
    setBusyId(id);
    setActionError(null);
    try {
      await endRelationship(token, id, reason);
      await refresh(token);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't go through — please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function onLogout() {
    clearClientToken();
    router.replace("/client-login");
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Broker relationships</h1>
          <p className="mt-1 text-sm text-muted-foreground">REL-003/005/007. Everyone on your panel, and anyone you&apos;ve invited.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onLogout}>
          Sign out
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Invite a broker</CardTitle>
          <CardDescription>REL-003. They must already have a brok3r broker account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onInvite} className="flex items-end gap-3">
            <Field label="Broker email" htmlFor="inviteEmail" className="flex-1">
              <Input
                id="inviteEmail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Type" htmlFor="inviteType" className="w-48">
              <Select id="inviteType" value={inviteType} onChange={(e) => setInviteType(e.target.value as RelationshipType)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={inviting}>
              {inviting ? "Sending…" : "Invite"}
            </Button>
          </form>
          {inviteError && <p className="mt-3 text-sm text-destructive">{inviteError}</p>}
          {inviteSent && <p className="mt-3 text-sm text-status-success-fg">Invitation sent.</p>}
        </CardContent>
      </Card>

      {actionError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {relationships.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No relationships yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {relationships.map((r) => {
            const busy = busyId === r.id;
            const brokerName = r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : null;
            return (
              <Card key={r.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle>{brokerName ?? r.email ?? "Broker"}</CardTitle>
                    <CardDescription>{TYPES.find((t) => t.value === r.type)?.label ?? r.type}</CardDescription>
                  </div>
                  <StatusBadge domain="relationship" value={r.status} />
                </CardHeader>
                <CardContent className="space-y-3">
                  {r.status === "active" && (
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        placeholder="Reason (required)"
                        value={endReasonById[r.id] ?? ""}
                        onChange={(e) => setEndReasonById((s) => ({ ...s, [r.id]: e.target.value }))}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                      />
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => onEnd(r.id)}>
                        End
                      </Button>
                    </div>
                  )}
                  {r.status === "pending_acceptance" && (
                    <p className="text-xs text-muted-foreground">Waiting on the broker to accept.</p>
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
