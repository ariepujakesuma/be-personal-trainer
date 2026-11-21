import { normalizeScan, scanSchema } from './scan';

describe('normalizeScan', () => {
  it('maps a Zepp-style report (muscle and bone in kg and %)', () => {
    const raw = scanSchema.parse({
      weight_kg: 89.2,
      bmi: 30.9,
      body_fat_pct: 30.9,
      water_pct: 49.3,
      muscle_pct: 65.6,
      bone_pct: 3.5,
      bmr_kcal: 1815,
      visceral_fat: 13,
      lean_mass_kg: 61.6,
      body_fat_kg: 27.6,
      bone_kg: 3.1,
      muscle_kg: 58.5,
    });
    expect(normalizeScan(raw)).toEqual({
      weightKg: 89.2,
      date: null,
      values: {
        bmi: 30.9,
        bodyFatPct: 30.9,
        visceralFat: 13,
        muscleKg: 58.5,
        waterPct: 49.3,
        bmrKcal: 1815,
        leanMassKg: 61.6,
        boneMassKg: 3.1,
      },
    });
  });

  it('converts InBody litres/kg to % and drops nonsense', () => {
    const raw = scanSchema.parse({
      weight_kg: 85.7,
      water_l: 41.5,
      protein_kg: 11.2,
      body_fat_kg: 29.1,
      visceral_fat: 999,
      measured_date: '2026-01-18',
    });
    expect(normalizeScan(raw)).toMatchObject({
      weightKg: 85.7,
      date: '2026-01-18',
      values: { waterPct: 48.4, proteinPct: 13.1, bodyFatPct: 34, leanMassKg: 56.6 },
    });
    expect(normalizeScan(raw).values.visceralFat).toBeUndefined();
  });
});
