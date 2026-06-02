import { Button } from "@/components/ui/Button";

// Placeholder step — the real Instagram (Unipile) connection lands in a later stage.
export function Step4Instagram() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-brand-500 to-pink-500 text-2xl text-white">
          ◎
        </div>
        <div>
          <p className="text-base font-semibold text-slate-800">Prepojte svoj Instagram</p>
          <p className="mt-1 text-sm text-slate-500">
            AI bude odpovedať zákazníkom priamo vo vašich správach.
          </p>
        </div>
        <Button type="button" variant="secondary" disabled>
          Pripojiť Instagram
        </Button>
        <p className="text-xs font-medium text-brand-700">
          Instagram pripojíte po dokončení onboardingu priamo na dashboarde.
        </p>
      </div>
    </div>
  );
}
