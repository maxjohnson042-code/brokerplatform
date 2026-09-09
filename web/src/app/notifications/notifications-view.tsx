"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  getStoredToken,
  getStoredClientToken,
  listMyNotifications,
  getNotificationPreferences,
  setNotificationPreference,
  NOTIFICATION_CATEGORIES,
  MANDATORY_NOTIFICATION_CATEGORIES,
  type Notification,
  type NotificationPreference,
} from "@/lib/thriski-api";

function NotificationsPanel({ token, label }: { token: string; label: string }) {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, prefs] = await Promise.all([listMyNotifications(token), getNotificationPreferences(token)]);
    setNotifications(list);
    setPreferences(prefs);
  }, [token]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof ApiError ? err.message : "Could not load notifications."));
  }, [refresh]);

  function isEnabled(category: string): boolean {
    const pref = preferences.find((p) => p.category === category);
    return pref ? pref.enabled : true;
  }

  async function toggle(category: string, enabled: boolean) {
    try {
      await setNotificationPreference(token, category, enabled);
      await refresh();
    } catch {
      // Mandatory-category rejection (409) or transient error — refresh will show the true state either way.
      await refresh();
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{label} — preferences</CardTitle>
          <CardDescription>NOT-005. Mandatory categories can&apos;t be disabled.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {NOTIFICATION_CATEGORIES.map((category) => {
              const mandatory = MANDATORY_NOTIFICATION_CATEGORIES.has(category);
              const enabled = isEnabled(category);
              return (
                <li key={category} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">
                    {category.replace(/_/g, " ")}
                    {mandatory && <span className="ml-2 text-xs text-muted-foreground">(mandatory)</span>}
                  </span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={mandatory}
                      onChange={(e) => toggle(category, e.target.checked)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{label} — notifications</CardTitle>
        </CardHeader>
        <CardContent>
          {!notifications ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-3">
              {notifications.map((n) => (
                <li key={n.id} className="border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{n.subject}</p>
                    <span className="text-xs text-muted-foreground">
                      {n.suppressed ? "suppressed (preference disabled)" : n.sent_at ? "sent" : "pending"}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function NotificationsView() {
  const [brokerToken, setBrokerToken] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | null>(null);

  useEffect(() => {
    setBrokerToken(getStoredToken());
    setClientToken(getStoredClientToken());
  }, []);

  if (!brokerToken && !clientToken) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Sign in as a broker or a lender to see your notifications.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">NOT-005/007.</p>
      </div>
      {brokerToken && <NotificationsPanel token={brokerToken} label="Broker" />}
      {clientToken && <NotificationsPanel token={clientToken} label="Lender" />}
    </div>
  );
}
