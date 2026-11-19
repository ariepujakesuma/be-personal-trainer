export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'recomp' | 'lose' | 'maintain' | 'gain';

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Calorie adjustment vs TDEE per goal (PRD F1). */
export const GOAL_ADJUSTMENT: Record<Goal, number> = {
  recomp: -400,
  lose: -500,
  maintain: 0,
  gain: 300,
};

const PROTEIN_G_PER_KG: Record<Goal, number> = {
  recomp: 1.8,
  lose: 1.8,
  maintain: 1.6,
  gain: 1.8,
};

const FAT_SHARE = 0.25;
const MIN_CALORIES: Record<Sex, number> = { male: 1500, female: 1200 };

export interface TargetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Mifflin-St Jeor BMR. */
export function bmr({
  sex,
  age,
  heightCm,
  weightKg,
}: Pick<TargetInput, 'sex' | 'age' | 'heightCm' | 'weightKg'>) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (sex === 'male' ? 5 : -161);
}

export function computeTargets(input: TargetInput): Targets {
  const b = bmr(input);
  const tdee = b * ACTIVITY_FACTOR[input.activityLevel];
  const calories = Math.max(MIN_CALORIES[input.sex], Math.round(tdee + GOAL_ADJUSTMENT[input.goal]));
  const proteinG = Math.round(input.weightKg * PROTEIN_G_PER_KG[input.goal]);
  const fatG = Math.round((calories * FAT_SHARE) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  return { bmr: Math.round(b), tdee: Math.round(tdee), calories, proteinG, carbsG, fatG };
}
