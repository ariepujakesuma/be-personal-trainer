import { calibrate, slopePerDay } from './calibration';

const base = { sex: 'male' as const, goal: 'recomp' as const, formulaTdee: 2400, currentTarget: 2000 };
const weights = (start: number, perDay: number) =>
  [0, 7, 14, 21, 27].map((day) => ({ day, kg: start + perDay * day }));

describe('calibration', () => {
  it('fits a straight trend', () => {
    expect(slopePerDay(weights(80, -0.05))).toBeCloseTo(-0.05);
  });

  it('needs 14 logged days and 4 weigh-ins over 14 days', () => {
    const r = calibrate({ ...base, dailyIntake: Array(10).fill(2000), burnTotal: 0, weights: weights(80, 0) });
    expect(r.status).toBe('not_enough');
  });

  it('derives TDEE from intake and the weight trend', () => {
    // Eating 2000 and losing 0.05 kg/day → 2000 + 0.05*7700 = 2385 kcal/day used.
    const r = calibrate({ ...base, dailyIntake: Array(20).fill(2000), burnTotal: 28 * 200, weights: weights(80, -0.05) });
    expect(r.status).toBe('ready');
    if (r.status === 'not_enough') return;
    expect(r.observedTdee).toBe(2385);
    expect(r.avgBurn).toBe(200);
    // (2385 - 200 exercise) - 400 recomp = 1785 → rounded to 10
    expect(r.suggestedCalories).toBe(1790);
  });

  it('flags results far from the formula as unreliable (meals likely missing)', () => {
    const r = calibrate({ ...base, dailyIntake: Array(20).fill(900), burnTotal: 0, weights: weights(80, 0) });
    expect(r.status).toBe('unreliable');
  });
});
