"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  getAccreditation,
  getAccreditationOutstandingItems,
  listTrainingConfirmations,
  requestAccreditationInformation,
  escalateAccreditation,
  approveAccreditation,
  declineAccreditation,
  confirmTraining,
  activateAccreditation,
  downloadDocument,
  type AccreditationFullContext,
  type OutstandingItemsResult,
  type TrainingConfirmation,
} from "@/lib/thriski-api";

export function ClientAccreditationDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [context, setContext] = useState<AccreditationFullContext | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingItemsResult | null>(null);
  const [confirmations, setConfirmations] = useState<TrainingConfirmation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemisedReasons, setItemisedReasons] = useState("");
  const [rationale, setRationale] = useState("");

  const refresh = useCallback(async (activeToken: string) => {
    const [ctxResult, outstandingResult, confirmationsResult] = await Promise.all([
      getAccreditation(activeToken, id),
      getAccreditationOutstandingItems(activeToken, id),
      listTrainingConfirmations(activeToken, id),
    ]);
    setContext(ctxResult);
    setOutstanding(outstandingResult);
    setConfirmations(confirmationsResult);
  }, [id]);

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
      setError(err instanceof ApiError ? err.message : "Could not load this accreditation.");
    });
  }, [router, refresh]);

  async function runAction(action: () => Promise<unknown>) {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh(token);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That action didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!context || !token) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const { accreditation, profile, business, evidence, checkResults, decisions } = context;
  const canDecide = accreditation.status === "requested" || accreditation.status === "exception_escalated";
  const profileName = profile ? `${(profile as { first_name?: string }).first_name ?? ""} ${(profile as { last_name?: string }).last_name ?? ""}`.trim() : null;
  const businessName = business ? (business as { legal_name?: string }).legal_name : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {accreditation.brand} — {accreditation.role}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {accreditation.classification.replace(/_/g, " ")} · {accreditation.product_scope}
          </p>
        </div>
        <StatusBadge domain="accreditation" value={accreditation.status} />
      </div>

      {actionError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>
      )}

      {/* REV-002: profile, business, checks and outstanding items on one screen. */}
      <div className="mb-6 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Broker</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">
            {profileName || "—"}
            {profile && <p className="text-muted-foreground">{(profile as { email?: string }).email}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">{businessName || "—"}</CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Outstanding requirements</CardTitle>
        </CardHeader>
        <CardContent>
          {!outstanding || !outstanding.rulesetConfigured ? (
            <p className="text-sm text-muted-foreground">No ruleset configured for this key.</p>
          ) : outstanding.items.length === 0 ? (
            <p className="text-sm text-status-success-fg">Nothing outstanding.</p>
          ) : (
            <ul className="space-y-1">
              {outstanding.items.map((item) => (
                <li key={item.groupId} className="text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Documents and checks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Evidence</p>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">None uploaded.</p>
            ) : (
              <ul className="text-sm text-foreground">
                {evidence.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span>{e.document_type ?? "unknown"}</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => token && downloadDocument(token, e.id, e.original_filename ?? `${e.document_type ?? "document"}`)}
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Check results</p>
            {checkResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="text-sm text-foreground">
                {checkResults.map((c, i) => (
                  <li key={i}>
                    {c.check_type}: {c.outcome}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {canDecide && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Review decision</CardTitle>
            <CardDescription>REV-003/004/006. {accreditation.current_decision_step === "senior_approver" && "Escalated — only a senior_approver may approve or decline."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Textarea
                placeholder="Itemised reasons, one per line, for a request-more-information action"
                value={itemisedReasons}
                onChange={(e) => setItemisedReasons(e.target.value)}
                rows={2}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy || !itemisedReasons.trim()}
                onClick={() => runAction(() => requestAccreditationInformation(token, id, itemisedReasons.split("\n").map((l) => l.trim()).filter(Boolean)))}
              >
                Request more information
              </Button>
            </div>
            <div>
              <Textarea placeholder="Rationale (used for escalate/approve/decline)" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} />
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction(() => escalateAccreditation(token, id, rationale || undefined))}>
                  Escalate
                </Button>
                <Button size="sm" disabled={busy} onClick={() => runAction(() => approveAccreditation(token, id, rationale || undefined))}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !rationale.trim()}
                  onClick={() => runAction(() => declineAccreditation(token, id, rationale))}
                >
                  Decline
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {accreditation.status === "pending" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Training</CardTitle>
            <CardDescription>
              TRN-005/006. Confirm platform/product training happened off-platform, then activate independently — confirming never
              auto-activates.
              {accreditation.training_deadline_at && ` Deadline: ${new Date(accreditation.training_deadline_at).toLocaleDateString()}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm">
              {(["platform", "product"] as const).map((kind) => {
                const confirmed = confirmations.find((c) => c.kind === kind);
                return (
                  <li key={kind} className="flex items-center justify-between">
                    <span className="text-foreground">{kind}</span>
                    {confirmed ? (
                      <span className="text-status-success-fg">Confirmed {new Date(confirmed.confirmed_at).toLocaleDateString()}</span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction(() => confirmTraining(token, id, kind))}>
                        Confirm {kind}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button disabled={busy} onClick={() => runAction(() => activateAccreditation(token, id))}>
              Activate accreditation
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decision history</CardTitle>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-3">
              {decisions.map((d) => (
                <li key={d.id} className="border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <p className="font-medium text-foreground">{d.decision_type.replace(/_/g, " ")}</p>
                  {d.rationale && <p className="text-muted-foreground">{d.rationale}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
