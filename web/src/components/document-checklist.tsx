"use client";

import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { downloadDocument, type DocumentRecord, type DocumentOutstandingItem } from "@/lib/thriski-api";
import type { DocumentCatalogEntry } from "@/lib/document-catalog";

// ONB-007/DOC-001: one required-documents checklist, shared by the broker-profile
// and per-business document sections — combines the catalog (what document types
// exist and whether each is required) with what's actually been uploaded
// (`documents`) and what's currently missing/expired (`outstanding`, from the
// backend's own getOutstandingDocumentItems — the source of truth for "missing",
// not re-derived client-side) into one row per document type.
export function DocumentChecklist({
  token,
  catalog,
  documents,
  outstanding,
  editable,
  onUpload,
  busyType,
  uploadError,
}: {
  token: string;
  catalog: DocumentCatalogEntry[];
  documents: DocumentRecord[];
  outstanding: DocumentOutstandingItem[];
  editable: boolean;
  onUpload: (documentType: string, file: File) => void;
  busyType: string | null;
  uploadError: string | null;
}) {
  const byType = new Map(documents.map((d) => [d.document_type, d]));
  const outstandingByType = new Map(outstanding.map((o) => [o.field, o.reason]));

  return (
    <ul className="space-y-3">
      {catalog.map((entry) => (
        <DocumentRow
          key={entry.documentType}
          token={token}
          entry={entry}
          document={byType.get(entry.documentType)}
          outstandingReason={outstandingByType.get(entry.documentType)}
          editable={editable}
          busy={busyType === entry.documentType}
          error={busyType === entry.documentType ? uploadError : null}
          onUpload={(file) => onUpload(entry.documentType, file)}
        />
      ))}
    </ul>
  );
}

function DocumentRow({
  token,
  entry,
  document: doc,
  outstandingReason,
  editable,
  busy,
  error,
  onUpload,
}: {
  token: string;
  entry: DocumentCatalogEntry;
  document?: DocumentRecord;
  outstandingReason?: string;
  editable: boolean;
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onUpload(file);
  }

  let status: { text: string; className: string };
  if (outstandingReason) {
    status = { text: doc ? "Expired" : "Missing", className: entry.required === true ? "text-status-danger-fg" : "text-status-warning-fg" };
  } else if (doc) {
    status = { text: `Uploaded ${new Date(doc.captured_at).toLocaleDateString()}`, className: "text-status-success-fg" };
  } else {
    status = { text: "Not provided", className: "text-muted-foreground" };
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {entry.label}
          {entry.required === true && <span className="text-destructive"> *</span>}
        </p>
        <p className={`text-xs ${status.className}`}>{outstandingReason ?? status.text}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {doc && (
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => downloadDocument(token, doc.id, doc.original_filename ?? entry.label)}
          >
            Download
          </button>
        )}
        {editable && (
          <>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? "Uploading…" : doc ? "Replace" : "Upload"}
            </Button>
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" className="sr-only" onChange={onFileChange} />
          </>
        )}
      </div>
    </li>
  );
}
