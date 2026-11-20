import { LIFT } from './catalog';
import { nextTarget, runMet, weeklyKmTarget } from './progression';

const rx = { lift: 'squat', sets: 3, min: 6, max: 10 };
const sets = (w: number, ...reps: number[]) => reps.map((value) => ({ value, weightKg: w }));

describe('progression', () => {
  it('starts at the bottom of the range with no weight', () => {
    const t = nextTarget(LIFT.squat, rx, null);
    expect(t).toMatchObject({ sets: 3, value: 6, weightKg: null });
  });

  it('adds a rep at the same weight until the top of the range', () => {
    expect(nextTarget(LIFT.squat, rx, sets(60, 8, 8, 7))).toMatchObject({ value: 8, weightKg: 60 });
  });

  it('adds weight once every set hits the top', () => {
    expect(nextTarget(LIFT.squat, rx, sets(60, 10, 10, 10))).toMatchObject({ value: 6, weightKg: 65 });
    expect(nextTarget(LIFT.bench, { ...rx, lift: 'bench' }, sets(40, 10, 10, 10))).toMatchObject({
      weightKg: 42.5,
    });
  });

  it('holds weight when below the range', () => {
    expect(nextTarget(LIFT.squat, rx, sets(80, 6, 5, 4))).toMatchObject({ value: 6, weightKg: 80 });
  });

  it('progresses bodyweight reps and timed holds', () => {
    expect(
      nextTarget(LIFT.pushup, { lift: 'pushup', sets: 3, min: 6, max: 15 }, [
        { value: 9 },
        { value: 8 },
        { value: 7 },
      ]),
    ).toMatchObject({ value: 8 });
    expect(
      nextTarget(LIFT.plank, { lift: 'plank', sets: 3, min: 30, max: 60 }, [
        { value: 40 },
        { value: 35 },
        { value: 30 },
      ]),
    ).toMatchObject({ value: 35 });
  });

  it('ramps weekly distance by 10%', () => {
    expect(weeklyKmTarget(10)).toBe(11);
    expect(weeklyKmTarget(0)).toBeNull();
  });

  it('picks running MET from pace', () => {
    expect(runMet(5, 30)).toBe(9.8); // 10 km/h
    expect(runMet(null, 30)).toBe(7);
  });
});
