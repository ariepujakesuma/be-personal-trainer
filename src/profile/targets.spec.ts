import { bmr, computeTargets } from './targets';

describe('targets', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    // 10*80 + 6.25*175 - 5*30 + 5 = 1748.75
    expect(bmr({ sex: 'male', age: 30, heightCm: 175, weightKg: 80 })).toBeCloseTo(1748.75);
    // 10*60 + 6.25*160 - 5*30 - 161 = 1289
    expect(bmr({ sex: 'female', age: 30, heightCm: 160, weightKg: 60 })).toBe(1289);
  });

  it('applies the recomp defaults: TDEE -400, protein 1.8 g/kg, fat 25%', () => {
    const t = computeTargets({
      sex: 'male',
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: 'moderate',
      goal: 'recomp',
    });
    expect(t.tdee).toBe(Math.round(1748.75 * 1.55)); // 2711
    expect(t.calories).toBe(2711 - 400);
    expect(t.proteinG).toBe(144);
    expect(t.fatG).toBe(Math.round((2311 * 0.25) / 9));
    expect(t.carbsG).toBe(Math.round((2311 - 144 * 4 - t.fatG * 9) / 4));
  });

  it('never goes below the safety floor', () => {
    const t = computeTargets({
      sex: 'female',
      age: 60,
      heightCm: 150,
      weightKg: 45,
      activityLevel: 'sedentary',
      goal: 'lose',
    });
    expect(t.calories).toBe(1200);
  });
});
