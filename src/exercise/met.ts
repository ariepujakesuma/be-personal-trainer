export type Intensity = 'light' | 'moderate' | 'vigorous';

/**
 * Seed data. MET values follow the Compendium of Physical Activities
 * for the "moderate" version of each activity; intensity scales them.
 */
export const EXERCISE_TYPES: { name: string; category: string; metValue: number }[] = [
  { name: 'Jalan santai', category: 'Kardio', metValue: 3.5 },
  { name: 'Jalan cepat', category: 'Kardio', metValue: 4.3 },
  { name: 'Jogging', category: 'Kardio', metValue: 7.0 },
  { name: 'Lari', category: 'Kardio', metValue: 9.8 },
  { name: 'Sepeda santai', category: 'Kardio', metValue: 4.0 },
  { name: 'Sepeda', category: 'Kardio', metValue: 8.0 },
  { name: 'Renang', category: 'Kardio', metValue: 5.8 },
  { name: 'Lompat tali', category: 'Kardio', metValue: 11.8 },
  { name: 'Hiking', category: 'Kardio', metValue: 6.0 },
  { name: 'Elliptical', category: 'Kardio', metValue: 5.0 },
  { name: 'Rowing machine', category: 'Kardio', metValue: 7.0 },
  { name: 'Senam aerobik', category: 'Kardio', metValue: 7.3 },
  { name: 'HIIT / circuit', category: 'Kardio', metValue: 8.0 },
  { name: 'Angkat beban', category: 'Kekuatan', metValue: 3.5 },
  { name: 'Calisthenics', category: 'Kekuatan', metValue: 3.8 },
  { name: 'Futsal', category: 'Olahraga', metValue: 7.0 },
  { name: 'Sepak bola', category: 'Olahraga', metValue: 7.0 },
  { name: 'Badminton', category: 'Olahraga', metValue: 5.5 },
  { name: 'Basket', category: 'Olahraga', metValue: 6.5 },
  { name: 'Tenis', category: 'Olahraga', metValue: 8.0 },
  { name: 'Tenis meja', category: 'Olahraga', metValue: 4.0 },
  { name: 'Voli', category: 'Olahraga', metValue: 4.0 },
  { name: 'Yoga', category: 'Fleksibilitas', metValue: 2.5 },
  { name: 'Pilates', category: 'Fleksibilitas', metValue: 3.0 },
  { name: 'Stretching', category: 'Fleksibilitas', metValue: 2.3 },
];

export const INTENSITY_FACTOR: Record<Intensity, number> = {
  light: 0.8,
  moderate: 1.0,
  vigorous: 1.25,
};

/** Generic MET when the activity is not in the list. */
export const DEFAULT_MET = 5.0;

/** kcal = MET × weight (kg) × hours */
export function caloriesBurned(
  metValue: number,
  intensity: Intensity,
  weightKg: number,
  durationMin: number,
) {
  return Math.round(metValue * INTENSITY_FACTOR[intensity] * weightKg * (durationMin / 60));
}
