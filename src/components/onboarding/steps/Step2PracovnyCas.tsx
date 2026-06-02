import { DAY_KEYS, DAY_LABELS, type DayKey } from "@/lib/days";
import { FieldError } from "@/components/ui/FieldError";
import { inputClass, labelClass } from "@/components/ui/styles";
import type { StepProps } from "../types";

export function Step2PracovnyCas({ data, update, errors }: StepProps) {
  // Update a single day, preserving the rest of the week.
  function setDay(key: DayKey, patch: Partial<{ open: boolean; from: string; to: string }>) {
    update({
      workingHours: {
        ...data.workingHours,
        [key]: { ...data.workingHours[key], ...patch },
      },
    });
  }

  return (
    <div className="space-y-6">
      <FieldError message={errors.workingHours} />

      <div className="space-y-2.5">
        {DAY_KEYS.map((key) => {
          const day = data.workingHours[key];
          return (
            <div
              key={key}
              className="grid grid-cols-1 items-center gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_auto_auto]"
            >
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={day.open}
                  onChange={(e) => setDay(key, { open: e.target.checked })}
                />
                <span className="text-sm font-medium text-slate-800">{DAY_LABELS[key]}</span>
              </label>

              {day.open ? (
                <div className="flex items-center gap-2">
                  <div>
                    <input
                      type="time"
                      aria-label={`${DAY_LABELS[key]} – od`}
                      className={inputClass}
                      value={day.from}
                      onChange={(e) => setDay(key, { from: e.target.value })}
                    />
                    <FieldError message={errors[`workingHours.${key}.from`]} />
                  </div>
                  <span className="text-slate-400">–</span>
                  <div>
                    <input
                      type="time"
                      aria-label={`${DAY_LABELS[key]} – do`}
                      className={inputClass}
                      value={day.to}
                      onChange={(e) => setDay(key, { to: e.target.value })}
                    />
                    <FieldError message={errors[`workingHours.${key}.to`]} />
                  </div>
                </div>
              ) : (
                <span className="text-sm text-slate-400 sm:col-span-2">Zatvorené</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="max-w-xs">
        <label htmlFor="bufferMin" className={labelClass}>
          Prestávka medzi zákazníkmi (min)
        </label>
        <input
          id="bufferMin"
          type="number"
          min={0}
          max={240}
          step={5}
          className={inputClass}
          value={data.bufferMin}
          onChange={(e) => update({ bufferMin: e.target.value })}
        />
        <FieldError message={errors.bufferMin} />
        <p className="mt-1.5 text-xs text-slate-500">
          Voľný čas na upratanie a prípravu pred ďalším zákazníkom.
        </p>
      </div>
    </div>
  );
}
