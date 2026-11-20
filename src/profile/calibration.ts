import { GOAL_ADJUSTMENT, MIN_CALORIES, type Goal, type Sex } from './targets';

const KCAL_PER_KG = 7700;
export const CALIBRATION_WINDOW_DAYS = 28;
export const MIN_LOGGED_DAYS = 14;
export const MIN_WEIGH_INS = 4;
export const MIN_WEIGH_SPAN_DAYS = 14;

export interface CalibrationInput {
  sex: Sex;
  goal: Goal;
  /** Formula TDEE (Mifflin × activity) at the latest weight, without exercise. */
  formulaTdee: number;
  currentTarget: number;
  /** Total confirmed calories per logged day. */
  dailyIntake: number[];
  /** Total exercise calories over the whole window. */
  burnTotal: number;
  /** Weigh-ins as days since the window start. */
  weights: { day: number; kg: number }[];
}

export type Calibration =
  | { status: 'not_enough'; loggedDays: number; weighIns: number; weighSpanDays: number }
  | {
      status: 'ready' | 'unreliable';
      loggedDays: number;
      weighIns: number;
      weighSpanDays: number;
      avgIntake: number;
      avgBurn: number;
      weightChangePerWeek: number;
      /** Real energy use from intake and weight trend, exercise included. */
      observedTdee: number;
      formulaTdee: number;
      currentTarget: number;
      suggestedCalories: number;
    };

/** Least-squares slope in kg per day; a trend line, so one heavy morning barely moves it. */
export function slopePerDay(points: { day: number; kg: number }[]): number {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.day, 0) / n;
  const my = points.reduce((s, p) => s + p.kg, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.day - mx) ** 2, 0);
  if (sxx === 0) return 0;
  return points.reduce((s, p) => s + (p.day - mx) * (p.kg - my), 0) / sxx;
}

/**
 * Energy balance from real data: what was eaten minus what the weight trend says was stored.
 * The suggestion leaves exercise out because the app credits exercise back each day.
 */
export function calibrate(input: CalibrationInput): Calibration {
  const loggedDays = input.dailyIntake.length;
  const weighIns = input.weights.length;
  const days = input.weights.map((w) => w.day);
  const weighSpanDays = weighIns ? Math.max(...days) - Math.min(...days) : 0;
  if (loggedDays < MIN_LOGGED_DAYS || weighIns < MIN_WEIGH_INS || weighSpanDays < MIN_WEIGH_SPAN_DAYS) {
    return { status: 'not_enough', loggedDays, weighIns, weighSpanDays };
  }

  const avgIntake = input.dailyIntake.reduce((s, v) => s + v, 0) / loggedDays;
  const avgBurn = input.burnTotal / CALIBRATION_WINDOW_DAYS;
  const slope = slopePerDay(input.weights);
  // Rounded first, so the suggestion matches the numbers shown to the user.
  const observedTdee = Math.round(avgIntake - slope * KCAL_PER_KG);
  const base = observedTdee - Math.round(avgBurn);
  const suggested = Math.max(MIN_CALORIES[input.sex], Math.round((base + GOAL_ADJUSTMENT[input.goal]) / 10) * 10);
  // Far from the formula usually means meals were not all logged, not an unusual metabolism.
  const ratio = base / input.formulaTdee;
  return {
    status: ratio < 0.75 || ratio > 1.35 ? 'unreliable' : 'ready',
    loggedDays,
    weighIns,
    weighSpanDays,
    avgIntake: Math.round(avgIntake),
    avgBurn: Math.round(avgBurn),
    weightChangePerWeek: Math.round(slope * 7 * 100) / 100,
    observedTdee,
    formulaTdee: Math.round(input.formulaTdee),
    currentTarget: input.currentTarget,
    suggestedCalories: suggested,
  };
}
