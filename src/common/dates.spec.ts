import { addDays, ageOn, dayRange, localDate } from './dates';

describe('dates', () => {
  it('maps a Jakarta day to UTC bounds', () => {
    const { start, end } = dayRange('2026-11-19', 'Asia/Jakarta');
    expect(start.toISOString()).toBe('2026-11-18T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-19T17:00:00.000Z');
  });
  it('gives the local calendar date', () => {
    expect(localDate('Asia/Jakarta', new Date('2026-11-19T18:30:00Z'))).toBe('2026-11-20');
  });
  it('adds days across months', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('computes age before and after birthday', () => {
    expect(ageOn(new Date('1996-12-01T00:00:00Z'), '2026-11-19')).toBe(29);
    expect(ageOn(new Date('1996-11-19T00:00:00Z'), '2026-11-19')).toBe(30);
  });
});
