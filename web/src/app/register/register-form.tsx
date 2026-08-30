"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { registerBroker } from "@/lib/api-client";

// AU states — ONB-003's "State (drop-down)". A free-text state field is exactly the
// kind of thing that makes screening and address-matching harder downstream; a
// constrained list costs nothing here and pays off in Epic 7.
const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

const schema = z.object({
  firstName: z.string().min(1, "Enter your first name"),
  lastName: z.string().min(1, "Enter your last name"),
  email: z.string().email("Enter a valid email address"),
  phoneNumber: z.string().min(8, "Enter a valid phone number"),
  dateOfBirth: z.string().min(1, "Enter your date of birth"),
  experienceYears: z.coerce.number().min(0, "Enter a number of years").max(70),
  addressLine1: z.string().min(1, "Enter your street address"),
  city: z.string().min(1, "Enter your suburb or city"),
  state: z.enum(STATES, { message: "Select a state" }),
  postcode: z
    .string()
    .regex(/^\d{4}$/, "Enter a 4-digit postcode"),
  attestedTerms: z.literal(true, {
    message: "You must confirm you've read the privacy policy and terms to continue",
  }),
});

// z.coerce.number() means the form's INPUT type (what <input> elements produce, e.g.
// experienceYears as a string before coercion) differs from its OUTPUT type (what
// validation produces, experienceYears as a number) — react-hook-form 7.87 /
// @hookform/resolvers 5's three-generic useForm<TFieldValues, TContext,
// TTransformedValues> exists specifically for this. Collapsing to one generic (as an
// older tutorial or this assistant's training data might show) fails to typecheck.
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function RegisterForm() {
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "saved" | "submitted">("idle");

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) });

  async function onSaveDraft() {
    setSubmitState("saving");
    // ONB-008: draft save deliberately bypasses zod validation (getValues(), not
    // handleSubmit) — a broker should be able to save an incomplete form and come
    // back later rather than being blocked by the same required-field rules that
    // gate "Continue". Epic 2's real endpoint is a separate, more permissive PATCH;
    // this button is wired to the same mock for now since the point here is the UX
    // pattern, not the persistence.
    // Best-effort cast: draft values are, by definition, allowed to be incomplete or
    // still in their pre-coercion shape (e.g. experienceYears as a string) — the real
    // Epic 2 draft-save endpoint should accept a Partial<RegisterBrokerInput>, not
    // require the fully-validated shape this mock's signature currently demands.
    await registerBroker(getValues() as unknown as Parameters<typeof registerBroker>[0]);
    setSubmitState("saved");
  }

  async function onSubmit(values: FormOutput) {
    setSubmitState("saving");
    await registerBroker(values);
    setSubmitState("submitted");
  }

  if (submitState === "submitted") {
    return (
      <div className="rounded-lg border border-status-success-bg bg-status-success-bg/40 p-6">
        <p className="text-sm font-medium text-status-success-fg">Personal details saved</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Next: documents and identity verification (Epic 5/6) — not built in this scaffold yet.
        </p>
      </div>
    );
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field label="Phone number" htmlFor="phoneNumber" required error={errors.phoneNumber?.message}>
          <Input id="phoneNumber" type="tel" autoComplete="tel" aria-invalid={!!errors.phoneNumber} {...register("phoneNumber")} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of birth" htmlFor="dateOfBirth" required error={errors.dateOfBirth?.message}>
          <Input id="dateOfBirth" type="date" aria-invalid={!!errors.dateOfBirth} {...register("dateOfBirth")} />
        </Field>
        <Field
          label="Years of experience"
          htmlFor="experienceYears"
          required
          hint="Under 2 years? A mentoring letter will be required later (ONB-012)."
          error={errors.experienceYears?.message}
        >
          <Input
            id="experienceYears"
            type="number"
            min={0}
            aria-invalid={!!errors.experienceYears}
            {...register("experienceYears")}
          />
        </Field>
      </div>

      <Field label="Street address" htmlFor="addressLine1" required error={errors.addressLine1?.message}>
        <Input id="addressLine1" autoComplete="address-line1" aria-invalid={!!errors.addressLine1} {...register("addressLine1")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Suburb / city" htmlFor="city" required error={errors.city?.message}>
          <Input id="city" autoComplete="address-level2" aria-invalid={!!errors.city} {...register("city")} />
        </Field>
        <Field label="State" htmlFor="state" required error={errors.state?.message}>
          <Select id="state" defaultValue="" aria-invalid={!!errors.state} {...register("state")}>
            <option value="" disabled>
              Select…
            </option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Postcode" htmlFor="postcode" required error={errors.postcode?.message}>
          <Input id="postcode" inputMode="numeric" aria-invalid={!!errors.postcode} {...register("postcode")} />
        </Field>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
        <input
          id="attestedTerms"
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-input"
          {...register("attestedTerms")}
        />
        <label htmlFor="attestedTerms" className="text-sm text-foreground">
          I&apos;ve read and agree to the Thriski privacy policy and terms and conditions.
          <span className="block text-xs text-muted-foreground">Required before onboarding can begin — ONB-002.</span>
        </label>
      </div>
      {errors.attestedTerms && <p className="text-xs text-destructive">{errors.attestedTerms.message}</p>}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitState === "saving"}>
          {submitState === "saving" ? "Saving…" : "Continue"}
        </Button>
        <Button type="button" variant="outline" disabled={submitState === "saving"} onClick={onSaveDraft}>
          Save as draft
        </Button>
        {submitState === "saved" && (
          <span className="text-xs text-status-success-fg">Draft saved — come back any time.</span>
        )}
      </div>
    </form>
  );
}
