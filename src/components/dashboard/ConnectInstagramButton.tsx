"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function ConnectInstagramButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/connect", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "Nepodarilo sa spustiť pripojenie.");
        setLoading(false);
        return;
      }
      // Hand off to Unipile's hosted auth (white-label).
      window.location.href = json.url;
    } catch {
      setError("Nepodarilo sa spojiť so serverom.");
      setLoading(false);
    }
  }

  return (
    <div>
      <Button onClick={connect} disabled={loading}>
        {loading ? "Otváram…" : "Pripojiť Instagram"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
