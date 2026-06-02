import { FieldError } from "@/components/ui/FieldError";
import { inputClass, labelClass } from "@/components/ui/styles";
import type { StepProps } from "../types";

export function Step5Styl({ data, update, errors }: StepProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="aiStyle" className={labelClass}>
          Vaše staré správy zákazníkom
        </label>
        <textarea
          id="aiStyle"
          rows={12}
          className={`${inputClass} resize-y font-mono leading-relaxed`}
          placeholder={"Sem vložte 20 – 30 vašich starých správ zákazníkom…\n\nNapr.:\nAhoj, jasné, kľudne príď zajtra o 15:00 💈\nSuper, vidíme sa! Daj vedieť, keby niečo."}
          value={data.aiStyle}
          onChange={(e) => update({ aiStyle: e.target.value })}
        />
        <FieldError message={errors.aiStyle} />
      </div>

      <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900 ring-1 ring-brand-100">
        Toto naučí AI <strong>IBA váš štýl písania</strong> (tón, emoji) — nie ceny ani
        informácie. Tie si AI berie z vašich služieb a nastavení.
      </div>
    </div>
  );
}
