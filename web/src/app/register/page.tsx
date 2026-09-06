import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AUTH-001. Once you&apos;re signed in you&apos;ll fill in your personal details, licensing record and
            association membership — you can save progress and finish later.
          </p>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Account details</CardTitle>
              <CardDescription>Your email and password — used to sign in from now on.</CardDescription>
            </CardHeader>
            <CardContent>
              <RegisterForm />
            </CardContent>
          </Card>
        </div>

        <aside className="lg:pt-16">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="mb-4 text-sm font-medium text-foreground">Your onboarding journey</p>
            <OnboardingStepper currentIndex={0} />
          </div>
        </aside>
      </div>
    </div>
  );
}
