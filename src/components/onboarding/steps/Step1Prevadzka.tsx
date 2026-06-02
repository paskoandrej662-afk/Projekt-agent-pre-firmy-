import { FieldError } from "@/components/ui/FieldError";
import { inputClass, labelClass } from "@/components/ui/styles";
import type { StepProps } from "../types";

export function Step1Prevadzka({ data, update, errors }: StepProps) {
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="businessName" className={labelClass}>
          Názov prevádzky
        </label>
        <input
          id="businessName"
          type="text"
          className={inputClass}
          placeholder="Napr. Barber Shop Centrum"
          value={data.businessName}
          onChange={(e) => update({ businessName: e.target.value })}
          autoComplete="organization"
        />
        <FieldError message={errors.businessName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className={labelClass}>
            Telefón
          </label>
          <input
            id="phone"
            type="tel"
            className={inputClass}
            placeholder="+421 900 000 000"
            value={data.phone}
            onChange={(e) => update({ phone: e.target.value })}
            autoComplete="tel"
          />
          <FieldError message={errors.phone} />
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            E-mail
          </label>
          <input
            id="email"
            type="email"
            className={inputClass}
            placeholder="vas@email.sk"
            value={data.email}
            onChange={(e) => update({ email: e.target.value })}
            autoComplete="email"
          />
          <FieldError message={errors.email} />
        </div>
      </div>

      <div>
        <label htmlFor="address" className={labelClass}>
          Adresa
        </label>
        <input
          id="address"
          type="text"
          className={inputClass}
          placeholder="Ulica 1, 811 01 Bratislava"
          value={data.address}
          onChange={(e) => update({ address: e.target.value })}
          autoComplete="street-address"
        />
        <FieldError message={errors.address} />
      </div>
    </div>
  );
}
