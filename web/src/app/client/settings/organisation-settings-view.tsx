"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  clearClientToken,
  getStoredClientToken,
  getMyOrganisation,
  uploadOrganisationLogo,
  mediaUrl,
  type MyOrganisation,
} from "@/lib/thriski-api";

// The first organisation-settings screen for a client_admin — currently just the
// logo, the one branding field this app has any UI for so far (SetBrandingDto also
// carries primaryColor, unused by any screen yet).
export function OrganisationSettingsView() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [org, setOrg] = useState<MyOrganisation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = useCallback(async (activeToken: string) => {
    setOrg(await getMyOrganisation(activeToken));
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
      setLoadError(err instanceof ApiError ? err.message : "Could not load your organisation.");
    });
  }, [router, refresh]);

  async function onUploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!token || !file) return;
    setUploadError(null);
    setUploading(true);
    try {
      await uploadOrganisationLogo(token, file);
      await refresh(token);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not upload your logo.");
    } finally {
      setUploading(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organisation settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{org.name}</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>Shown to brokers wherever your organisation appears, e.g. their relationships list.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary">
              {org.branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(org.branding.logoUrl)} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary">
              {uploading ? "Uploading…" : "Upload logo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onUploadLogo} disabled={uploading} />
            </label>
          </div>
          {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
