"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearToken,
  getStoredToken,
  listMyAccreditations,
  requestAccreditation,
  listMyRelationships,
  listMyAffiliations,
  type Accreditation,
  type MyRelationship,
  type MyAffiliation,
  type AccreditationClassification,
} from "@/lib/thriski-api";

const CLASSIFICATIONS: { value: AccreditationClassification; label: string }[] = [
  { value: "new_broker_introducer", label: "New broker introducer" },
  { value: "new_referrer_introducer", label: "New referrer introducer" },
  { value: "transfer", label: "Transfer" },
  { value: "add_on", label: "Add-on accreditation" },
];

export function AccreditationsView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [accreditations, setAccreditations] = useState<Accreditation[] | null>(null);
  const [relationships, setRelationships] = useState<MyRelationship[]>([]);
  const [affiliations, setAffiliations] = useState<MyAffiliation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lenderId, setLenderId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [classification, setClassification] = useState<AccreditationClassification>("new_broker_introducer");
  const [brand, setBrand] = useState("default");
  const [role, setRole] = useState("broker");
  const [productScope, setProductScope] = useState("commercial");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string) => {
    const [mine, rels, affs] = await Promise.all([
      listMyAccreditations(activeToken),
      listMyRelationships(activeToken),
      listMyAffiliations(activeToken),
    ]);
    setAccreditations(mine);
    setRelationships(rels.filter((r) => r.status === "active"));
    setAffiliations(affs.filter((a) => a.status === "active"));
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
      setLoadError(err instanceof ApiError ? err.message : "Could not load your accreditations.");
    });
  }, [router, refresh]);

  useEffect(() => {
    if (!lenderId && relationships.length > 0) setLenderId(relationships[0].client_organisation_id);
  }, [relationships, lenderId]);
  useEffect(() => {
    if (!businessId && affiliations.length > 0) setBusinessId(affiliations[0].broker_business_id);
  }, [affiliations, businessId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !lenderId || !businessId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestAccreditation(token, {
        lenderClientOrganisationId: lenderId,
        brokerBusinessId: businessId,
        classification,
        brand,
        role,
        productScope,
        licenceHolderType: "broking_business",
        licenceHolderBrokerBusinessId: businessId,
      });
      await refresh(token);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not submit the request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!accreditations) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading your accreditations…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your accreditations</h1>
      <p className="mt-1 text-sm text-muted-foreground">ACR-001/002. Request accreditation with a lender you have an active relationship with.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Request accreditation</CardTitle>
          <CardDescription>Needs an active relationship (see My relationships) and an active business affiliation.</CardDescription>
        </CardHeader>
        <CardContent>
          {relationships.length === 0 || affiliations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You need at least one active lender relationship and one active business affiliation before requesting accreditation.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lender" htmlFor="lenderId">
                  <Select id="lenderId" value={lenderId} onChange={(e) => setLenderId(e.target.value)}>
                    {relationships.map((r) => (
                      <option key={r.id} value={r.client_organisation_id}>
                        {r.client_organisation_name ?? r.client_organisation_id}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Business" htmlFor="businessId">
                  <Select id="businessId" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                    {affiliations.map((a) => (
                      <option key={a.id} value={a.broker_business_id}>
                        {a.legal_name ?? a.broker_business_id}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Classification" htmlFor="classification">
                <Select id="classification" value={classification} onChange={(e) => setClassification(e.target.value as AccreditationClassification)}>
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Brand" htmlFor="brand" hint="Free text — matches the lender's configured ruleset key.">
                  <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
                </Field>
                <Field label="Role" htmlFor="role">
                  <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} />
                </Field>
                <Field label="Product scope" htmlFor="productScope">
                  <Input id="productScope" value={productScope} onChange={(e) => setProductScope(e.target.value)} />
                </Field>
              </div>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Requesting…" : "Request accreditation"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 space-y-4">
        {accreditations.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">No accreditations yet.</CardContent>
          </Card>
        ) : (
          accreditations.map((a) => (
            <Link key={a.id} href={`/accreditations/${a.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle>
                      {a.brand} — {a.role}
                    </CardTitle>
                    <CardDescription>
                      {a.classification.replace(/_/g, " ")} · {a.product_scope}
                    </CardDescription>
                  </div>
                  <StatusBadge domain="accreditation" value={a.status} />
                </CardHeader>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
