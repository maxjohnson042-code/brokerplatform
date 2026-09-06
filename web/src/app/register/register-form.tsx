"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { registerBroker, ApiError } from "@/lib/thriski-api";

// Matches RegisterBrokerDto (src/modules/identity/dto/register-broker.dto.ts) exactly
// — registration itself is just AUTH-001's four fields. Everything else (phone,
// DOB, experience, address, licensing) is Epic 3's PATCH /brokers/me, filled in on the
// /profile page after logging in — that's the real backend's actual step boundary,
// not an arbitrary UI choice.
const schema = z
  .object({
    firstName: z.string().min(1, "Enter your first name"),
    lastName: z.string().min(1, "Enter your last name"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitState("saving");
    setErrorMessage(null);
    try {
      await registerBroker({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
      });
      router.push(`/login?registered=1&email=${encodeURIComponent(values.email)}`);
    } catch (err) {
      setSubmitState("error");
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" required error={errors.firstName?.message}>
          <Input id="firstName" autoComplete="given-name" aria-invalid={!!errors.firstName} {...register("firstName")} />
        </Field>
        <Field label="Last name" htmlFor="lastName" required error={errors.lastName?.message}>
          <Input id="lastName" autoComplete="family-name" aria-invalid={!!errors.lastName} {...register("lastName")} />
        </Field>
      </div>

      <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" htmlFor="password" required hint="At least 12 characters." error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </Field>
      </div>

      {errorMessage && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitState === "saving"}>
          {submitState === "saving" ? "Creating account…" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
