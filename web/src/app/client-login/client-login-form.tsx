"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  loginClientUser,
  beginClientMfaEnrolment,
  confirmClientMfaEnrolment,
  verifyClientMfa,
  storeClientToken,
  type MfaEnrolmentStart,
} from "@/lib/thriski-api";

// AUTH-002/006: client_users always pass through MFA before getting a real access
// token. tokenType from /auth/client/login tells us which of the two paths applies —
// first-time enrolment (show the secret, then confirm a code) or a routine
// already-enrolled login (just ask for the next code). Same three-endpoint sequence
// test/identity/client-mfa.spec.ts already proves on the backend.
type Step =
  | { kind: "credentials" }
  | { kind: "enrol"; pendingToken: string; enrolment: MfaEnrolmentStart }
  | { kind: "verify"; pendingToken: string };

export function ClientLoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { pendingToken, tokenType } = await loginClientUser(email, password);
      if (tokenType === "mfa_enrolment_pending") {
        const enrolment = await beginClientMfaEnrolment(pendingToken);
        setStep({ kind: "enrol", pendingToken, enrolment });
      } else {
        setStep({ kind: "verify", pendingToken });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind === "credentials") return;
    setSubmitting(true);
    setError(null);
    try {
      const tokens =
        step.kind === "enrol"
          ? await confirmClientMfaEnrolment(step.pendingToken, code)
          : await verifyClientMfa(step.pendingToken, code);
      storeClientToken(tokens.accessToken);
      router.push("/client/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code didn't work — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step.kind === "credentials") {
    return (
      <form onSubmit={onSubmitCredentials} noValidate className="space-y-6">
        <Field label="Email address" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      {step.kind === "enrol" && (
        <Card>
          <CardHeader>
            <CardTitle>Set up your authenticator</CardTitle>
            <CardDescription>
              First sign-in — MFA is mandatory for lenders and aggregators (AUTH-006). Add this secret to any TOTP app
              (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it generates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
              {step.enrolment.secret}
            </p>
            <p className="text-xs text-muted-foreground">
              Save these backup codes somewhere safe — each can be used once if you lose access to your authenticator:{" "}
              {step.enrolment.backupCodes.join(", ")}
            </p>
          </CardContent>
        </Card>
      )}

      <form onSubmit={onSubmitCode} noValidate className="space-y-6">
        <Field label="6-digit code" htmlFor="code" required>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            required
          />
        </Field>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Verifying…" : step.kind === "enrol" ? "Confirm and sign in" : "Verify"}
        </Button>
      </form>
    </div>
  );
}
