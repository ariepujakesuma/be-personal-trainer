import { z } from 'zod';

/** Optional smart-scale readings, entered manually. `null` clears a value. */
const metric = (min: number, max: number, int = false) => {
  const n = z.coerce
    .number({ error: 'Harus berupa angka' })
    .min(min, `Minimal ${min}`)
    .max(max, `Maksimal ${max}`);
  return (int ? n.int('Harus bilangan bulat') : n).nullable().optional();
};

export const bodyCompSchema = z.object({
  bmi: metric(10, 80),
  bodyFatPct: metric(2, 75),
  visceralFat: metric(1, 60),
  muscleKg: metric(5, 150),
  waterPct: metric(20, 80),
  obesityDegreePct: metric(-60, 200),
  bmrKcal: metric(500, 5000, true),
  metabolicAge: metric(10, 100, true),
  leanMassKg: metric(10, 250),
  proteinPct: metric(3, 35),
  boneMassKg: metric(0.5, 10),
});
export type BodyComp = z.infer<typeof bodyCompSchema>;
export const BODY_COMP_FIELDS = Object.keys(bodyCompSchema.shape) as (keyof BodyComp)[];
