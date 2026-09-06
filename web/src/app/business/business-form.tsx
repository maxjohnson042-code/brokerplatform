"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import {
  ApiError,
  getStoredToken,
  lookupAbn,
  createBusiness,
  type AbnLookupOutcome,
  type AbnLookupResult,
} from "@/lib/thriski-api";

const ENTITY_TYPES = [
  { value: "company", label: "Company" },
  { value: "sole_trader", label: "Sole trader" },
  { value: "partnership", label: "Partnership" },
  { value: "trust", label: "Trust" },
];

// Best-effort default only — ABR's entity type codes are numerous and not a clean
// 1:1 map onto Thriski's four-value entity_type; the broker always confirms/changes
// this themselves (ONB-014 is "offered for one-click confirmation," not silent
// auto-fill), it's never submitted without being shown.
function suggestEntityType(code: string | null): string {
  if (!code) return "";
  if (code === "IND") return "sole_trader";
  if (code.includes("TRT") || code.includes("DIT") || code.includes("FUT")) return "trust";
  if (code === "PRV" || code === "PUB") return "company";
  if (code.startsWith("PTR") || code.includes("PART")) return "partnership";
  return "";
}

type FormValues = {
  entityType: string;
  legalName: string;
  tradingName: string;
  abn: string;
  businessEmail: string;
  gstRegistered: "" | "true" | "false";
  trusteeName: string;
  addressLine1: string;
  addressCity: string;
  addressState: string;
  addressPostcode: string;
};

const EMPTY_FORM: FormValues = {
  entityType: "",
  legalName: "",
  tradingName: "",
  abn: "",
  businessEmail: "",
  gstRegistered: "",
  trusteeName: "",
  addressLine1: "",
  addressCity: "",
  addressState: "",
  addressPostcode: "",
};

export function BusinessForm() {
  const router = useRouter();
  const [abnInput, setAbnInput] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "looking-up">("idle");
  const [lookupOutcome, setLookupOutcome] = useState<AbnLookupOutcome | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [createState, setCreateState] = useState<"idle" | "saving" | "created" | "error">("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<FormValues>({ defaultValues: EMPTY_FORM });

  function prefillFromRegistry(result: AbnLookupResult) {
    reset({
      ...EMPTY_FORM,
      entityType: suggestEntityType(result.entityTypeCode),
      legalName: result.entityName ?? "",
      tradingName: result.businessNames[0] ?? "",
      abn: result.abn,
      gstRegistered: result.gstRegistered ? "true" : "false",
      addressState: result.addressState ?? "",
      addressPostcode: result.addressPostcode ?? "",
    });
    setShowForm(true);
  }

  async function onLookup() {
    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLookupState("looking-up");
    setLookupOutcome(null);
    try {
      const outcome = await lookupAbn(token, abnInput);
      setLookupOutcome(outcome);
      if (outcome.status === "found") {
        prefillFromRegistry(outcome.result);
      } else if (outcome.status === "not_found" || outcome.status === "not_configured" || outcome.status === "error") {
        // Fall back to manual entry either way — ONB-014's lookup is an accelerator,
        // never a hard dependency for creating a business.
        reset({ ...EMPTY_FORM, abn: abnInput });
        setShowForm(true);
      }
    } finally {
      setLookupState("idle");
    }
  }

  function onEnterManually() {
    setLookupOutcome(null);
    reset({ ...EMPTY_FORM, abn: abnInput });
    setShowForm(true);
  }

  async function onSubmit(values: FormValues) {
    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setCreateState("saving");
    setCreateError(null);
    try {
      await createBusiness(token, {
        entityType: values.entityType,
        legalName: values.legalName || undefined,
        tradingName: values.tradingName || undefined,
        abn: values.abn || undefined,
        businessEmail: values.businessEmail || undefined,
        gstRegistered: values.gstRegistered === "" ? undefined : values.gstRegistered === "true",
        trusteeName: values.trusteeName || undefined,
        address:
          values.addressLine1 && values.addressCity && values.addressPostcode && values.addressState
            ? {
                line1: values.addressLine1,
                city: values.addressCity,
                postcode: values.addressPostcode,
                state: values.addressState,
              }
            : undefined,
      });
      setCreateState("created");
    } catch (err) {
      setCreateState("error");
      setCreateError(err instanceof ApiError ? err.message : "Could not create the business.");
    }
  }

  if (createState === "created") {
    return (
      <div className="rounded-lg border border-status-success-bg bg-status-success-bg/40 p-6">
        <p className="text-sm font-medium text-status-success-fg">Business created</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It starts as a draft — principals, verification and affiliation confirmation from other brokers
          follow in later steps of this build.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!showForm && (
        <div className="space-y-3">
          <Field
            label="ABN"
            htmlFor="abnLookup"
            hint="We'll look this up against the national business register and pre-fill what we find — you confirm before anything is saved (ONB-014)."
          >
            <div className="flex gap-3">
              <Input
                id="abnLookup"
                value={abnInput}
                onChange={(e) => setAbnInput(e.target.value)}
                placeholder="11 digits"
                inputMode="numeric"
              />
              <Button type="button" onClick={onLookup} disabled={lookupState === "looking-up" || !abnInput.trim()}>
                {lookupState === "looking-up" ? "Looking up…" : "Look up"}
              </Button>
            </div>
          </Field>

          {lookupOutcome?.status === "invalid_abn" && (
            <p className="text-sm text-destructive">That doesn&apos;t look like a valid ABN — check the digits and try again.</p>
          )}
          {lookupOutcome?.status === "not_found" && (
            <p className="text-sm text-muted-foreground">No business found on the register for that ABN.</p>
          )}
          {lookupOutcome?.status === "not_configured" && (
            <p className="text-sm text-muted-foreground">Automatic lookup isn&apos;t available right now.</p>
          )}
          {lookupOutcome?.status === "error" && (
            <p className="text-sm text-muted-foreground">Something went wrong looking that up.</p>
          )}

          <Button type="button" variant="outline" size="sm" onClick={onEnterManually}>
            Enter details manually instead
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {lookupOutcome?.status === "found" && (
            <p className="rounded-md border border-status-info-bg bg-status-info-bg/40 px-3 py-2 text-sm text-status-info-fg">
              Found on the register — confirm or correct the details below before creating.
              {lookupOutcome.result.entityTypeName && ` Registered entity type: ${lookupOutcome.result.entityTypeName}.`}
            </p>
          )}

          <Field label="Entity type" htmlFor="entityType" required>
            <Select id="entityType" {...register("entityType")}>
              <option value="">Select…</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal entity name" htmlFor="legalName" required>
              <Input id="legalName" {...register("legalName")} />
            </Field>
            <Field label="Trading name" htmlFor="tradingName">
              <Input id="tradingName" {...register("tradingName")} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ABN" htmlFor="abn">
              <Input id="abn" {...register("abn")} />
            </Field>
            <Field label="Business email" htmlFor="businessEmail" required>
              <Input id="businessEmail" type="email" {...register("businessEmail")} />
            </Field>
          </div>

          <Field label="GST registered" htmlFor="gstRegistered" required>
            <Select id="gstRegistered" {...register("gstRegistered")}>
              <option value="">Select…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>

          <Field label="Trustee name" htmlFor="trusteeName" hint="Only required if this is a trust.">
            <Input id="trusteeName" {...register("trusteeName")} />
          </Field>

          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Business address</p>
            <div className="space-y-4">
              <Field label="Address line 1" htmlFor="addressLine1" required>
                <Input id="addressLine1" {...register("addressLine1")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Suburb / city" htmlFor="addressCity" required>
                  <Input id="addressCity" {...register("addressCity")} />
                </Field>
                <Field label="State" htmlFor="addressState" required>
                  <Input id="addressState" {...register("addressState")} />
                </Field>
                <Field label="Postcode" htmlFor="addressPostcode" required>
                  <Input id="addressPostcode" {...register("addressPostcode")} />
                </Field>
              </div>
            </div>
          </div>

          {createError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={createState === "saving"}>
              {createState === "saving" ? "Creating…" : "Create business"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
