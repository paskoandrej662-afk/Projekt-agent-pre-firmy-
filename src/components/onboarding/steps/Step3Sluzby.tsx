import { FieldError } from "@/components/ui/FieldError";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/styles";
import type { ServiceRow, StepProps } from "../types";

const emptyRow = (): ServiceRow => ({ name: "", durationMin: "", priceEur: "" });

export function Step3Sluzby({ data, update, errors }: StepProps) {
  const rows = data.services;

  function setRow(index: number, patch: Partial<ServiceRow>) {
    update({
      services: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  }

  function addRow() {
    update({ services: [...rows, emptyRow()] });
  }

  function removeRow(index: number) {
    update({ services: rows.filter((_, i) => i !== index) });
  }

  return (
    <div className="space-y-5">
      <FieldError message={errors.services} />

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl bg-slate-50 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-start">
              <div>
                {i === 0 && <label className={labelClass}>Názov služby</label>}
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Strih + brada"
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                />
                <FieldError message={errors[`services.${i}.name`]} />
              </div>

              <div>
                {i === 0 && <label className={labelClass}>Trvanie (min)</label>}
                <input
                  type="number"
                  min={1}
                  step={5}
                  className={inputClass}
                  placeholder="45"
                  value={row.durationMin}
                  onChange={(e) => setRow(i, { durationMin: e.target.value })}
                />
                <FieldError message={errors[`services.${i}.durationMin`]} />
              </div>

              <div>
                {i === 0 && <label className={labelClass}>Cena (€)</label>}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  placeholder="20"
                  value={row.priceEur}
                  onChange={(e) => setRow(i, { priceEur: e.target.value })}
                />
                <FieldError message={errors[`services.${i}.priceEur`]} />
              </div>

              <div className={i === 0 ? "sm:pt-7" : ""}>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  aria-label="Odstrániť službu"
                >
                  Odstrániť
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={addRow}>
        + Pridať službu
      </Button>
    </div>
  );
}
