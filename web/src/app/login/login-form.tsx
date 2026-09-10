"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { loginBroker, storeToken, ApiError } from "@/lib/thriski-api";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";
  const prefillEmail = searchParams.get("email") ?? "";

  const [submitState, setSubmitState] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: prefillEmail } });

  async function onSubmit(values: FormValues) {
    setSubmitState("saving");
    setErrorMessage(null);
    try {
      const tokens = await loginBroker(values.email, values.password);
      storeToken(tokens.accessToken);
      router.push("/dashboard");
    } catch (err) {
      setSubmitState("error");
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {justRegistered && (
        <p className="rounded-md border border-status-success-bg bg-status-success-bg/40 px-3 py-2 text-sm text-status-success-fg">
          Account created — sign in to continue.
        </p>
      )}

      <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>

      {errorMessage && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Button type="submit" disabled={submitState === "saving"}>
        {submitState === "saving" ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
