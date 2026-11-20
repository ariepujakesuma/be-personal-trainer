import type { Lift, Prescription } from './catalog';

/** One logged set. `value` is reps, or seconds for timed holds. */
export interface SetLog {
  value: number;
  weightKg?: number | null;
}

export interface LiftTarget {
  sets: number;
  /** Reps or seconds per set. */
  value: number;
  weightKg: number | null;
  /** Why this is the target, in one line. */
  note: string;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Double progression: stay at a weight and add reps until every set reaches the top of the
 * range, then add weight and start again at the bottom. Bodyweight lifts add reps; holds add
 * seconds. `last` is the previous session's sets for this lift.
 */
export function nextTarget(lift: Lift, rx: Prescription, last: SetLog[] | null): LiftTarget {
  const base = { sets: rx.sets };
  const done = last?.filter((s) => s.value > 0) ?? [];
  if (!done.length) {
    return {
      ...base,
      value: rx.min,
      weightKg: null,
      note:
        lift.kind === 'weighted'
          ? 'Sesi pertama: pilih beban yang masih bisa 2 repetisi lagi di set terakhir.'
          : lift.kind === 'time'
            ? 'Sesi pertama: tahan selama bisa dengan posisi benar.'
            : 'Sesi pertama: lakukan sebanyak bisa dengan gerakan benar.',
    };
  }

  const lowest = Math.min(...done.map((s) => s.value));
  const allAtTop = done.length >= rx.sets && done.every((s) => s.value >= rx.max);

  if (lift.kind === 'time') {
    return { ...base, value: lowest + 5, weightKg: null, note: 'Tambah 5 detik dari set terlemah.' };
  }
  if (lift.kind === 'bodyweight') {
    return allAtTop
      ? {
          ...base,
          value: rx.max,
          weightKg: null,
          note: 'Semua set sudah maksimal. Pakai variasi lebih berat atau rompi beban.',
        }
      : {
          ...base,
          value: Math.min(rx.max, lowest + 1),
          weightKg: null,
          note: 'Tambah 1 repetisi dari set terlemah.',
        };
  }

  const weight = Math.max(...done.map((s) => s.weightKg ?? 0));
  if (!weight) {
    return {
      ...base,
      value: rx.min,
      weightKg: null,
      note: 'Isi beban yang dipakai supaya target bisa dihitung.',
    };
  }
  const step = lift.incrementKg ?? 2.5;
  if (allAtTop) {
    return {
      ...base,
      value: rx.min,
      weightKg: roundTo(weight + step, step >= 2.5 ? 1.25 : 0.5),
      note: `Semua set ${rx.max} repetisi: naik ${String(step).replace('.', ',')} kg.`,
    };
  }
  if (lowest < rx.min) {
    return {
      ...base,
      value: rx.min,
      weightKg: weight,
      note: `Beban sama, kejar minimal ${rx.min} repetisi di semua set.`,
    };
  }
  return {
    ...base,
    value: Math.min(rx.max, lowest + 1),
    weightKg: weight,
    note: 'Beban sama, tambah 1 repetisi.',
  };
}

/** Weekly distance goal: about 10% more than last week, the usual safe ramp. */
export function weeklyKmTarget(lastWeekKm: number): number | null {
  if (lastWeekKm <= 0) return null;
  return Math.round(lastWeekKm * 1.1 * 10) / 10;
}

/** Running MET from speed (Compendium): slower than ~6.5 km/h counts as jog/walk. */
export function runMet(distanceKm: number | null | undefined, durationMin: number): number {
  if (!distanceKm) return 7.0;
  const kmh = distanceKm / (durationMin / 60);
  if (kmh < 6.5) return 6.0;
  if (kmh < 8.4) return 8.3;
  if (kmh < 9.7) return 9.0;
  if (kmh < 10.8) return 9.8;
  if (kmh < 11.3) return 10.5;
  if (kmh < 12.1) return 11.0;
  if (kmh < 13.8) return 11.8;
  return 12.8;
}
