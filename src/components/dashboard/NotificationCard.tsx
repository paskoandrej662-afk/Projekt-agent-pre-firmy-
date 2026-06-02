"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type Props = {
  id: string;
  typeLabel: string;
  message: string;
  draftReply: string | null;
  customerHandle: string | null;
  createdAt: string;
};

export function NotificationCard({
  id,
  typeLabel,
  message,
  draftReply,
  customerHandle,
  createdAt,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function markRead() {
    setBusy(true);
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyDraft() {
    if (!draftReply) return;
    try {
      await navigator.clipboard.writeText(draftReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {typeLabel}
        </span>
        <span className="text-xs text-slate-400">{createdAt}</span>
      </div>
      <p className="mt-2 text-sm text-slate-700">{message}</p>
      {customerHandle && <p className="mt-1 text-xs text-slate-500">Zákazník: @{customerHandle}</p>}

      {draftReply && (
        <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-500">Návrh odpovede od AI:</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{draftReply}</p>
          <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={copyDraft}>
            {copied ? "Skopírované ✓" : "Kopírovať návrh"}
          </Button>
        </div>
      )}

      <div className="mt-3">
        <Button variant="secondary" onClick={markRead} disabled={busy}>
          {busy ? "…" : "Označiť ako vybavené"}
        </Button>
      </div>
    </div>
  );
}
