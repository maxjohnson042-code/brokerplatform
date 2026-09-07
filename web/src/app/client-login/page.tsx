import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientLoginForm } from "./client-login-form";

export default function ClientLoginPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lender / aggregator sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">AUTH-002/006. Accounts are provisioned by your organisation&apos;s admin.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>MFA is required on every account — you&apos;ll be prompted for a code after your password.</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientLoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
