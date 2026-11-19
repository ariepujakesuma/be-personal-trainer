import { extractJson } from './json';
import { foodAnalysisSchema } from './schemas';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses JSON wrapped in prose', () => {
    expect(extractJson('Berikut hasilnya: {"a":1} semoga membantu')).toEqual({ a: 1 });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('maaf tidak bisa')).toThrow();
  });
  it('coerces numeric strings in food analysis', () => {
    const parsed = foodAnalysisSchema.parse({
      items: [{ name: 'Nasi', grams: '200', calories: '260', protein_g: 5, carbs_g: 57, fat_g: 0.5 }],
    });
    expect(parsed.items[0].calories).toBe(260);
    expect(parsed.assumptions).toEqual([]);
  });
});
