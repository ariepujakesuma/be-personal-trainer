import { caloriesBurned } from './met';

describe('caloriesBurned', () => {
  it('uses MET x kg x hours', () => {
    expect(caloriesBurned(9.8, 'moderate', 80, 30)).toBe(392);
  });
  it('scales with intensity', () => {
    expect(caloriesBurned(3.5, 'vigorous', 80, 60)).toBe(350);
    expect(caloriesBurned(3.5, 'light', 80, 60)).toBe(224);
  });
});
