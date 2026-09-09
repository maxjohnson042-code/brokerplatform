"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearToken,
  getStoredToken,
  listMyAffiliations,
  initiateKyb,
  type MyAffiliation,
} from "@/lib/thriski-api";

// IDV-002/009: KYB verification per business, via MockKybAdapter behind the same
// IdentityVerificationProvider interface as Sumsub KYC — see mock-kyb-adapter.ts.
export function BusinessList() {
  const router = useRouter();
  const [affiliations, setAffiliations] = useState<MyAffiliation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [kybError, setKybError] = useState<string | null>(null);

  const refresh = useCallback(async (token: string) => {
    setAffiliations(await listMyAffiliations(token));
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    refresh(token).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : "Could not load your businesses.");
    });
  }, [router, refresh]);

  async function onStartKyb(businessId: string) {
    const token = getStoredToken();
    if (!token) return;
    setKybError(null);
    setStartingId(businessId);
    try {
      await initiateKyb(token, businessId);
      await refresh(token);
    } catch (err) {
      setKybError(err instanceof ApiError ? err.message : "Could not start verification.");
    } finally {
      setStartingId(null);
    }
  }

  const active = affiliations.filter((a) => a.status === "active" && a.broker_business_id);
  if (active.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Business verification</CardTitle>
        <CardDescription>IDV-001/002 — KYB check for each business you&apos;re affiliated with.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {kybError && <p className="text-xs text-destructive">{kybError}</p>}
        {active.map((a) => {
          const status = a.business_status ?? "draft";
          return (
            <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{a.legal_name ?? a.trading_name ?? "Unnamed business"}</p>
                <div className="mt-1">
                  <StatusBadge domain="business" value={status} />
                </div>
              </div>
              {status !== "in_verification" && status !== "verified" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={startingId === a.broker_business_id}
                  onClick={() => onStartKyb(a.broker_business_id)}
                >
                  {startingId === a.broker_business_id
                    ? "Starting…"
                    : status === "attention_required"
                      ? "Retry verification"
                      : "Start verification"}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
