import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Start your onboarding</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Takes about five minutes. You can save your progress and finish later.
          </p>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>ONB-003 — this information stays private until you choose to share it with a lender, aggregator or association.</CardDescription>
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
