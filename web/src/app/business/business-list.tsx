"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { DocumentChecklist } from "@/components/document-checklist";
import { BUSINESS_DOCUMENT_CATALOG } from "@/lib/document-catalog";
import {
  ApiError,
  clearToken,
  getStoredToken,
  listMyAffiliations,
  initiateKyb,
  listBusinessDocuments,
  getBusinessDocumentOutstandingItems,
  uploadBusinessDocument,
  type MyAffiliation,
  type DocumentRecord,
  type DocumentOutstandingItem,
} from "@/lib/thriski-api";

// IDV-002/009: KYB verification per business, via MockKybAdapter behind the same
// IdentityVerificationProvider interface as Sumsub KYC — see mock-kyb-adapter.ts.
export function BusinessList() {
  const router = useRouter();
  const [affiliations, setAffiliations] = useState<MyAffiliation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [kybError, setKybError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          const expanded = expandedId === a.broker_business_id;
          return (
            <div key={a.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{a.legal_name ?? a.trading_name ?? "Unnamed business"}</p>
                  <div className="mt-1">
                    <StatusBadge domain="business" value={status} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedId(expanded ? null : a.broker_business_id)}
                  >
                    {expanded ? "Hide documents" : "Documents"}
                  </Button>
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
              </div>
              {/* Documents stay uploadable regardless of business status — several
                  types (e.g. PI certificate) are explicitly periodic-renewal by
                  design (Section 14, DOC-006's versioning), unlike the business
                  form's own fields which lock once submitted. */}
              {expanded && <BusinessDocuments businessId={a.broker_business_id} editable={true} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function BusinessDocuments({ businessId, editable }: { businessId: string; editable: boolean }) {
  const [token] = useState(getStoredToken());
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [outstanding, setOutstanding] = useState<DocumentOutstandingItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string) => {
    const [docs, docOutstanding] = await Promise.all([
      listBusinessDocuments(activeToken, businessId),
      getBusinessDocumentOutstandingItems(activeToken, businessId),
    ]);
    setDocuments(docs);
    setOutstanding(docOutstanding);
  }, [businessId]);

  useEffect(() => {
    if (!token) return;
    refresh(token).catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load documents."));
  }, [token, refresh]);

  async function onUpload(documentType: string, file: File) {
    if (!token) return;
    setUploadError(null);
    setBusyType(documentType);
    try {
      await uploadBusinessDocument(token, businessId, { documentType }, file);
      await refresh(token);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not upload this document.");
    } finally {
      setBusyType(null);
    }
  }

  if (!token) return null;
  if (loadError) return <p className="mt-3 text-xs text-destructive">{loadError}</p>;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <DocumentChecklist
        token={token}
        catalog={BUSINESS_DOCUMENT_CATALOG}
        documents={documents}
        outstanding={outstanding}
        editable={editable}
        onUpload={onUpload}
        busyType={busyType}
        uploadError={uploadError}
      />
    </div>
  );
}
