import { z } from 'zod';
import { bodyCompSchema, type BodyComp } from './body-comp';

/**
 * What the model reads off a scale-app screenshot: each number as shown, with its unit kept
 * apart (muscle in kg vs %, water in L vs %). Converting is done in code, not by the model.
 */
const n = z.coerce.number().finite().nullable().optional().catch(null);

export const scanSchema = z.object({
  measured_date: z.string().nullable().optional().catch(null),
  weight_kg: n,
  weight_lb: n,
  bmi: n,
  body_fat_pct: n,
  body_fat_kg: n,
  water_pct: n,
  water_l: n,
  muscle_kg: n,
  muscle_pct: n,
  skeletal_muscle_kg: n,
  bone_kg: n,
  bone_pct: n,
  bmr_kcal: n,
  visceral_fat: n,
  lean_mass_kg: n,
  protein_pct: n,
  protein_kg: n,
  metabolic_age: n,
  obesity_degree_pct: n,
});
export type ScanRaw = z.infer<typeof scanSchema>;

export const SCAN_SYSTEM_PROMPT = `Kamu membaca screenshot hasil timbangan pintar atau alat komposisi tubuh (Xiaomi/Zepp, Renpho, Tanita, InBody, Omron, Huawei, aplikasi lain).
Salin angka yang TERLIHAT JELAS ke field JSON di bawah. Jangan menghitung, menebak, atau mengonversi satuan. Kalau tidak ada di gambar, isi null.
Perhatikan satuannya: angka yang sama bisa muncul dalam kg dan %, masukkan ke field yang sesuai satuannya.
- "Muscle Mass %" → muscle_pct, "Muscle Mass" kg → muscle_kg, "Skeletal Muscle (Mass)" kg → skeletal_muscle_kg
- "Bone Mass %" → bone_pct, "Bone Mass" kg → bone_kg
- "Body Fat %" → body_fat_pct, "Body Fat Mass" kg → body_fat_kg
- "Water %" / "Body Water" % → water_pct, "Total Body Water" L → water_l
- "Lean Body Mass" / "Fat-free Mass" / "Weight without fat" → lean_mass_kg
- "BMR" / "Basal Metabolic Rate" / "Metabolism" → bmr_kcal
- "Visceral Fat" level → visceral_fat (bukan Visceral Fat Area cm²)
- "Body Age" / "Metabolic Age" / "Actual Age" → metabolic_age
- "Protein" % → protein_pct, kg → protein_kg
- "Obesity Degree" / "Obesity" % → obesity_degree_pct
Abaikan label status (HIGH, LOW, Standard, Normal) dan skor. Tanggal pengukuran kalau terlihat → measured_date format YYYY-MM-DD.
Balas hanya JSON dengan field: measured_date, weight_kg, weight_lb, bmi, body_fat_pct, body_fat_kg, water_pct, water_l, muscle_kg, muscle_pct, skeletal_muscle_kg, bone_kg, bone_pct, bmr_kcal, visceral_fat, lean_mass_kg, protein_pct, protein_kg, metabolic_age, obesity_degree_pct.`;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Turns what was read into the app's fields: % of weight for water and protein, kg for
 * muscle and bone. Values outside the form's ranges are dropped, not guessed.
 */
export function normalizeScan(raw: ScanRaw): {
  weightKg: number | null;
  values: Partial<BodyComp>;
  date: string | null;
} {
  const v = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? null : x);
  const weightKg = v(raw.weight_kg) ?? (v(raw.weight_lb) != null ? r1(raw.weight_lb! * 0.45359237) : null);
  const ofWeight = (kg: number | null) => (kg == null || !weightKg ? null : r1((kg / weightKg) * 100));
  const kgOf = (pct: number | null) => (pct == null || !weightKg ? null : r1((pct / 100) * weightKg));

  const bodyFatPct = v(raw.body_fat_pct) ?? ofWeight(v(raw.body_fat_kg));
  const candidate: Partial<Record<keyof BodyComp, number | null>> = {
    bmi: v(raw.bmi),
    bodyFatPct,
    visceralFat: v(raw.visceral_fat),
    muscleKg: v(raw.muscle_kg) ?? kgOf(v(raw.muscle_pct)) ?? v(raw.skeletal_muscle_kg),
    waterPct: v(raw.water_pct) ?? ofWeight(v(raw.water_l)),
    obesityDegreePct: v(raw.obesity_degree_pct),
    bmrKcal: v(raw.bmr_kcal) == null ? null : Math.round(raw.bmr_kcal!),
    metabolicAge: v(raw.metabolic_age) == null ? null : Math.round(raw.metabolic_age!),
    leanMassKg:
      v(raw.lean_mass_kg) ?? (weightKg && bodyFatPct != null ? r1(weightKg * (1 - bodyFatPct / 100)) : null),
    proteinPct: v(raw.protein_pct) ?? ofWeight(v(raw.protein_kg)),
    boneMassKg: v(raw.bone_kg) ?? kgOf(v(raw.bone_pct)),
  };

  const values: Partial<BodyComp> = {};
  for (const [key, val] of Object.entries(candidate) as [keyof BodyComp, number | null][]) {
    if (val == null) continue;
    if (bodyCompSchema.shape[key].safeParse(val).success) values[key] = val;
  }
  const date = raw.measured_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.measured_date) ? raw.measured_date : null;
  return { weightKg: weightKg != null && weightKg >= 25 && weightKg <= 350 ? weightKg : null, values, date };
}
