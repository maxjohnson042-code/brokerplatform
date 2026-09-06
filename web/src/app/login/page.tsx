import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">AUTH-002.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Broker sign in</CardTitle>
          <CardDescription>Use the email and password from registration.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
