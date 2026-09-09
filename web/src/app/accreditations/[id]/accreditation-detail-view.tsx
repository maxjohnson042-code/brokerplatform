"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  getStoredToken,
  getAccreditation,
  getAccreditationOutstandingItems,
  listTrainingConfirmations,
  type AccreditationFullContext,
  type OutstandingItemsResult,
  type TrainingConfirmation,
} from "@/lib/thriski-api";

export function AccreditationDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [context, setContext] = useState<AccreditationFullContext | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingItemsResult | null>(null);
  const [confirmations, setConfirmations] = useState<TrainingConfirmation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (token: string) => {
    const [ctxResult, outstandingResult, confirmationsResult] = await Promise.all([
      getAccreditation(token, id),
      getAccreditationOutstandingItems(token, id),
      listTrainingConfirmations(token, id),
    ]);
    setContext(ctxResult);
    setOutstanding(outstandingResult);
    setConfirmations(confirmationsResult);
  }, [id]);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      router.replace("/login");
      return;
    }
    refresh(stored).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearAndRedirect();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not load this accreditation.");
    });
    function clearAndRedirect() {
      router.replace("/login");
    }
  }, [router, refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const { accreditation, decisions } = context;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Outstanding requirements</CardTitle>
          <CardDescription>Resolved from the lender&apos;s configured ruleset.</CardDescription>
        </CardHeader>
        <CardContent>
          {!outstanding || !outstanding.rulesetConfigured ? (
            <p className="text-sm text-muted-foreground">No ruleset is configured for this lender/brand/role/scope combination yet.</p>
          ) : outstanding.items.length === 0 ? (
            <p className="text-sm text-status-success-fg">Nothing outstanding.</p>
          ) : (
            <ul className="space-y-2">
              {outstanding.items.map((item) => (
                <li key={item.groupId} className="text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground"> — {item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {accreditation.training_deadline_at && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Training</CardTitle>
            <CardDescription>
              Deadline: {new Date(accreditation.training_deadline_at).toLocaleDateString()}. Confirmed by your lender, not self-reported.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {confirmations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing confirmed yet.</p>
            ) : (
              <ul className="space-y-1">
                {confirmations.map((c) => (
                  <li key={c.id} className="text-sm text-status-success-fg">
                    {c.kind} — confirmed {new Date(c.confirmed_at).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decision history</CardTitle>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {decisions.map((d) => (
                <li key={d.id} className="border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <p className="font-medium text-foreground">{d.decision_type.replace(/_/g, " ")}</p>
                  {d.rationale && <p className="text-muted-foreground">{d.rationale}</p>}
                  {d.itemised_reasons && (
                    <ul className="ml-4 list-disc text-muted-foreground">
                      {d.itemised_reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
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
