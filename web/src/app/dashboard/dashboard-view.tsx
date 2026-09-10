"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, CheckCircle2, Circle, Link2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { getStatusMeta } from "@/lib/status";
import {
  ApiError,
  clearToken,
  getStoredToken,
  getMyProfile,
  getOutstandingItems,
  listAssociationMemberships,
  getMyDocumentOutstandingItems,
  listMyAffiliations,
  listMyAccreditations,
  listMyRelationships,
  listMyNotifications,
  mediaUrl,
  type BrokerProfile,
  type OutstandingItem,
  type AssociationMembership,
  type DocumentOutstandingItem,
  type MyAffiliation,
  type Accreditation,
  type MyRelationship,
  type Notification,
} from "@/lib/thriski-api";

type ChecklistItem = { label: string; done: boolean };

export function DashboardView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<BrokerProfile | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingItem[]>([]);
  const [memberships, setMemberships] = useState<AssociationMembership[]>([]);
  const [docOutstanding, setDocOutstanding] = useState<DocumentOutstandingItem[]>([]);
  const [affiliations, setAffiliations] = useState<MyAffiliation[]>([]);
  const [accreditations, setAccreditations] = useState<Accreditation[]>([]);
  const [relationships, setRelationships] = useState<MyRelationship[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string) => {
    const [freshProfile, items, associations, docItems, affs, accrs, rels, notifs] = await Promise.all([
      getMyProfile(activeToken),
      getOutstandingItems(activeToken),
      listAssociationMemberships(activeToken),
      getMyDocumentOutstandingItems(activeToken),
      listMyAffiliations(activeToken),
      listMyAccreditations(activeToken),
      listMyRelationships(activeToken),
      listMyNotifications(activeToken),
    ]);
    setProfile(freshProfile);
    setOutstanding(items);
    setMemberships(associations);
    setDocOutstanding(docItems);
    setAffiliations(affs);
    setAccreditations(accrs);
    setRelationships(rels);
    setNotifications(notifs);
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
      setLoadError(err instanceof ApiError ? err.message : "Could not load your dashboard.");
    });
  }, [router, refresh]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!token || !profile) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
      </div>
    );
  }

  const checklist: ChecklistItem[] = [
    { label: "Personal details complete", done: outstanding.length === 0 },
    { label: "Required documents uploaded", done: docOutstanding.length === 0 },
    { label: "Association membership added", done: memberships.length > 0 },
    { label: "Privacy policy and terms attested", done: !!profile.attested_terms_at },
    { label: "Profile submitted", done: profile.status !== "draft" },
    { label: "Identity verified", done: profile.status === "verified" },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const activeBusinesses = affiliations.filter((a) => a.status === "active" && a.broker_business_id);
  const activeRelationships = relationships.filter((r) => r.status === "active");

  const accreditationBuckets = { active: 0, attention: 0, inProgress: 0 };
  for (const a of accreditations) {
    const meaning = getStatusMeta("accreditation", a.status).meaning;
    if (meaning === "success") accreditationBuckets.active += 1;
    else if (meaning === "warning" || meaning === "danger") accreditationBuckets.attention += 1;
    else if (meaning === "info") accreditationBuckets.inProgress += 1;
  }

  const recentNotifications = [...notifications]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back, {profile.first_name || "there"}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge domain="profile" value={profile.status} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>{doneCount} of {checklist.length} complete</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {checklist.map((item) => (
                <li key={item.label}>
                  <Link href="/profile" className="flex items-center gap-2 text-sm hover:underline">
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success-fg" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
            <CardDescription>Your affiliated businesses and their verification status.</CardDescription>
          </CardHeader>
          <CardContent>
            {activeBusinesses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No business yet.{" "}
                <Link href="/business" className="text-primary hover:underline">
                  Set one up
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {activeBusinesses.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {a.legal_name ?? a.trading_name ?? "Unnamed business"}
                    </span>
                    <StatusBadge domain="business" value={a.business_status ?? "draft"} />
                  </li>
                ))}
              </ul>
            )}
            <Link href="/business" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              View business →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accreditations</CardTitle>
            <CardDescription>{accreditations.length} total.</CardDescription>
          </CardHeader>
          <CardContent>
            {accreditations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accreditations yet.{" "}
                <Link href="/accreditations" className="text-primary hover:underline">
                  Request one
                </Link>
                .
              </p>
            ) : (
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="text-lg font-semibold text-status-success-fg">{accreditationBuckets.active}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-status-info-fg">{accreditationBuckets.inProgress}</p>
                  <p className="text-xs text-muted-foreground">In progress</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-status-warning-fg">{accreditationBuckets.attention}</p>
                  <p className="text-xs text-muted-foreground">Needs attention</p>
                </div>
              </div>
            )}
            <Link href="/accreditations" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              View accreditations →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Relationships</CardTitle>
            <CardDescription>{activeRelationships.length} active link{activeRelationships.length === 1 ? "" : "s"}.</CardDescription>
          </CardHeader>
          <CardContent>
            {activeRelationships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not linked to anyone yet.{" "}
                <Link href="/relationships" className="text-primary hover:underline">
                  Find a lender or aggregator
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {activeRelationships.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm text-foreground">
                    {r.client_organisation_logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(r.client_organisation_logo_url)}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded border border-border object-contain bg-card"
                      />
                    ) : (
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    {r.client_organisation_name ?? "Unknown organisation"}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/relationships" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
              View relationships →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentNotifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="space-y-3">
              {recentNotifications.map((n) => (
                <li key={n.id} className="flex items-start gap-2 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-foreground">{n.subject}</p>
                    <p className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
            View all notifications →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
