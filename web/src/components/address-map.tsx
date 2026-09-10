"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geocodeAddress, type GeocodeOutcome } from "@/lib/thriski-api";

// Leaflet's default marker icon references image paths relative to leaflet.css that
// don't resolve through a bundler — the marker-icon/-2x/-shadow PNGs are copied into
// public/leaflet/ (see web/public/leaflet/) and referenced here as plain static
// paths, sidestepping any bundler-specific static-image-import behaviour entirely.
const defaultIcon = L.icon({
  iconUrl: "/leaflet/marker-icon.png",
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Map view for addresses (UI polish) — free, keyless OpenStreetMap tiles + Nominatim
// geocoding proxied through our own backend (src/modules/geocoding). This whole
// component must never run during SSR (Leaflet needs `window`) — callers dynamically
// import it with `{ ssr: false }`, same as the pattern established here.
export function AddressMap({ token, address }: { token: string; address: string }) {
  const [outcome, setOutcome] = useState<GeocodeOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!address.trim()) {
      setOutcome(null);
      return;
    }
    geocodeAddress(token, address)
      .then((result) => {
        if (!cancelled) setOutcome(result);
      })
      .catch(() => {
        if (!cancelled) setOutcome({ status: "error", detail: "Could not look up this address." });
      });
    return () => {
      cancelled = true;
    };
  }, [token, address]);

  if (!address.trim()) {
    return <p className="text-sm text-muted-foreground">Enter an address above to see it on the map.</p>;
  }
  if (!outcome) {
    return <p className="text-sm text-muted-foreground">Locating…</p>;
  }
  if (outcome.status === "not_found") {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t locate this address on the map.</p>;
  }
  if (outcome.status === "error") {
    return <p className="text-sm text-muted-foreground">Map unavailable right now.</p>;
  }

  return (
    <div className="h-56 w-full overflow-hidden rounded-md border border-border">
      <MapContainer center={[outcome.lat, outcome.lon]} zoom={15} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[outcome.lat, outcome.lon]} icon={defaultIcon}>
          <Popup>{outcome.displayName}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
