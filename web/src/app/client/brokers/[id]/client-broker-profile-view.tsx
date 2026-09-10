"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  getClientBrokerProfile,
  listClientBrokerAssociations,
  listClientBrokerDocuments,
  listClientBrokerBusinesses,
  listClientBrokerAccreditations,
  listOrganisationRelationships,
  downloadDocument,
  mediaUrl,
  type BrokerProfile,
  type AssociationMembership,
  type DocumentRecord,
  type ClientBrokerBusiness,
  type Accreditation,
  type OrganisationRelationship,
} from "@/lib/thriski-api";
import { requestedAgoLabel, trainingDeadlineLabel, documentExpiryLabel } from "@/lib/date-labels";

// Mirrors relationships-view.tsx's own SCOPE_DESCRIPTIONS — small enough not to be
// worth extracting into a shared module for one more read-only caller.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  lender_full: "Full profile, licensing, documents and accreditation history.",
  aggregator_full: "Full profile, licensing, documents and accreditation history, as your aggregator.",
  association_membership_only: "Membership status only — not your profile, documents or accreditation history.",
};

function formatAddress(address: BrokerProfile["address"]): string {
  if (!address) return "";
  return [address.line1, address.line2, address.city, address.state, address.postcode].filter(Boolean).join(", ");
}

type Data = {
  profile: BrokerProfile;
  relationship: OrganisationRelationship | null;
  associations: AssociationMembership[];
  documents: DocumentRecord[];
  businesses: ClientBrokerBusiness[];
  accreditations: Accreditation[];
};

export function ClientBrokerProfileView({ brokerId }: { brokerId: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string) => {
    const [profile, relationships, associations, documents, businesses, accreditations] = await Promise.all([
      getClientBrokerProfile(activeToken, brokerId),
      listOrganisationRelationships(activeToken),
      listClientBrokerAssociations(activeToken, brokerId),
      listClientBrokerDocuments(activeToken, brokerId),
      listClientBrokerBusinesses(activeToken, brokerId),
      listClientBrokerAccreditations(activeToken, brokerId),
    ]);
    setData({
      profile,
      relationship: relationships.find((r) => r.broker_profile_id === brokerId) ?? null,
      associations,
      documents,
      businesses,
      accreditations,
    });
  }, [brokerId]);

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
      setError(
        err instanceof ApiError && err.status === 403
          ? "You don't have an active relationship with this broker."
          : err instanceof ApiError
            ? err.message
            : "Could not load this broker's profile.",
      );
    });
  }, [router, refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data || !token) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const { profile, relationship, associations, documents, businesses, accreditations } = data;
  const fullName = `${profile.first_name} ${profile.last_name}`.trim();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-lg font-semibold text-secondary-foreground">
          {profile.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(profile.photo_url)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>
              {(profile.first_name?.[0] ?? "").toUpperCase()}
              {(profile.last_name?.[0] ?? "").toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{fullName || "Broker"}</h1>
          <p className="text-sm text-muted-foreground">
            {profile.email}
            {profile.phone_number && ` · ${profile.phone_number}`}
          </p>
        </div>
        <StatusBadge domain="profile" value={profile.status} />
      </div>

      {relationship && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Relationship</CardTitle>
            <CardDescription>
              {relationship.type.replace(/_/g, " ")} · consented{" "}
              {relationship.consented_at ? new Date(relationship.consented_at).toLocaleDateString() : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {SCOPE_DESCRIPTIONS[relationship.shared_data_scope] ?? relationship.shared_data_scope}
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal & licensing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Date of birth:</span> {profile.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString() : "—"}</p>
            <p><span className="text-muted-foreground">Address:</span> {formatAddress(profile.address) || "—"}</p>
            <p><span className="text-muted-foreground">Experience:</span> {profile.experience_years ? `${profile.experience_years} years` : "—"}</p>
            <p><span className="text-muted-foreground">Licence type:</span> {profile.licence_type_held ?? "—"}</p>
            {profile.credit_licence_number && (
              <p><span className="text-muted-foreground">Credit licence number:</span> {profile.credit_licence_number}</p>
            )}
            {profile.credit_representative_number && (
              <p><span className="text-muted-foreground">Credit representative number:</span> {profile.credit_representative_number}</p>
            )}
            {profile.licensing_entity_name && (
              <p><span className="text-muted-foreground">Licensing entity:</span> {profile.licensing_entity_name} {profile.licensing_entity_number ? `(${profile.licensing_entity_number})` : ""}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Association memberships</CardTitle>
          </CardHeader>
          <CardContent>
            {associations.length === 0 ? (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {associations.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>
                      {m.association_name} <span className="text-muted-foreground">#{m.membership_number}</span>
                    </span>
                    {m.confirmed_by_association && <span className="text-xs text-status-success-fg">Confirmed</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Business affiliations</CardTitle>
        </CardHeader>
        <CardContent>
          {businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">None active.</p>
          ) : (
            <ul className="space-y-2">
              {businesses.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{b.legal_name ?? b.trading_name ?? "Unnamed business"}</p>
                    <p className="text-xs text-muted-foreground">{b.entity_type?.replace(/_/g, " ")} · {b.role}</p>
                  </div>
                  {b.business_status && <StatusBadge domain="business" value={b.business_status} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">None uploaded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {documents.map((d) => {
                const expiry = d.expiry_date ? documentExpiryLabel(d.expiry_date) : null;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>
                      {d.document_type.replace(/_/g, " ")}
                      {expiry && (
                        <span className={expiry.overdue ? "ml-2 text-xs font-medium text-status-danger-fg" : "ml-2 text-xs text-muted-foreground"}>
                          {expiry.label}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => downloadDocument(token, d.id, d.original_filename ?? d.document_type)}
                    >
                      Download
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accreditation history with you</CardTitle>
        </CardHeader>
        <CardContent>
          {accreditations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accreditations requested yet.</p>
          ) : (
            <ul className="space-y-2">
              {accreditations.map((a) => {
                const training = a.status === "pending" && a.training_deadline_at ? trainingDeadlineLabel(a.training_deadline_at) : null;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/client/accreditations/${a.id}`}
                      className="block rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {a.brand} — {a.role}{" "}
                          <span className="text-muted-foreground">
                            · {a.classification.replace(/_/g, " ")} · {a.product_scope}
                          </span>
                        </span>
                        <StatusBadge domain="accreditation" value={a.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {requestedAgoLabel(a.requested_at)}
                        {a.current_decision_step === "senior_approver" && (
                          <span className="ml-2 font-medium text-status-warning-fg">Escalated — senior approver required</span>
                        )}
                        {training && (
                          <span className={training.overdue ? "ml-2 font-medium text-status-danger-fg" : "ml-2"}>{training.label}</span>
                        )}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
