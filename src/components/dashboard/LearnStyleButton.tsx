"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function LearnStyleButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function learn() {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/instagram/learn-style", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Nepodarilo sa načítať štýl.");
      } else {
        setMsg(`Štýl načítaný z ${json.count ?? 0} správ.`);
        router.refresh();
      }
    } catch {
      setError("Nepodarilo sa spojiť so serverom.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button variant="secondary" onClick={learn} disabled={loading || disabled}>
        {loading ? "Načítavam…" : "Načítať môj štýl z Instagramu"}
      </Button>
      {disabled && <p className="mt-2 text-xs text-slate-400">Najprv pripojte Instagram.</p>}
      {msg && <p className="mt-2 text-sm text-green-600">{msg}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
