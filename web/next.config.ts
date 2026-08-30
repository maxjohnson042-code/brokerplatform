import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // This is a two-package repo (thriski/ backend, thriski/web frontend), not a
  // workspace-managed monorepo — Turbopack's root auto-detection walks up looking for
  // a git boundary and finds package-lock.json files at both the repo root and here,
  // which is ambiguous. Pinning root to this directory is the documented fix and
  // matches reality: this package's dependency tree is self-contained.
  turbopack: {
    root: dirname,
  },
};

export default nextConfig;
