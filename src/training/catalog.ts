/**
 * Training catalog: lifts, strength programs and running plans. Static on purpose: a program
 * is a fixed recipe, and progression comes from the user's own logged sets (progression.ts).
 */

export type LiftKind = 'weighted' | 'bodyweight' | 'time';

export interface Lift {
  id: string;
  name: string;
  kind: LiftKind;
  /** Weight added when every set reaches the top of the rep range. */
  incrementKg?: number;
  /** Short how-to shown under the name. */
  cue: string;
}

export const LIFTS: Lift[] = [
  {
    id: 'squat',
    name: 'Squat (barbell)',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Turun sampai paha sejajar lantai, punggung tetap lurus.',
  },
  {
    id: 'bench',
    name: 'Bench press',
    kind: 'weighted',
    incrementKg: 2.5,
    cue: 'Turunkan bar ke dada bawah, siku sekitar 45°.',
  },
  {
    id: 'row',
    name: 'Barbell row',
    kind: 'weighted',
    incrementKg: 2.5,
    cue: 'Badan condong ±45°, tarik bar ke perut.',
  },
  {
    id: 'rdl',
    name: 'Romanian deadlift',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Dorong pinggul ke belakang, lutut sedikit tekuk, bar dekat kaki.',
  },
  {
    id: 'deadlift',
    name: 'Deadlift',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Bar di atas tengah kaki, dorong lantai, punggung netral.',
  },
  {
    id: 'ohp',
    name: 'Overhead press',
    kind: 'weighted',
    incrementKg: 2.5,
    cue: 'Dorong bar lurus ke atas kepala, perut dikencangkan.',
  },
  {
    id: 'pulldown',
    name: 'Lat pulldown',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Tarik bar ke dada atas, bahu turun.',
  },
  {
    id: 'pullup',
    name: 'Pull-up',
    kind: 'bodyweight',
    cue: 'Dagu melewati bar. Belum bisa? Pakai band atau mesin assisted.',
  },
  {
    id: 'leg_press',
    name: 'Leg press',
    kind: 'weighted',
    incrementKg: 10,
    cue: 'Lutut searah jari kaki, jangan dikunci di atas.',
  },
  {
    id: 'leg_curl',
    name: 'Leg curl',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Gerak pelan, tahan sebentar di atas.',
  },
  {
    id: 'calf_raise',
    name: 'Calf raise',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Naik setinggi mungkin, turun pelan.',
  },
  {
    id: 'incline_db',
    name: 'Incline dumbbell press',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Bangku 30°, dumbbell turun sejajar dada.',
  },
  {
    id: 'db_shoulder',
    name: 'Dumbbell shoulder press',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Duduk tegak, dorong ke atas tanpa melengkungkan punggung.',
  },
  {
    id: 'split_squat',
    name: 'Bulgarian split squat',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Kaki belakang di bangku, beban per tangan. Repetisi per kaki.',
  },
  {
    id: 'hip_thrust',
    name: 'Hip thrust',
    kind: 'weighted',
    incrementKg: 5,
    cue: 'Punggung atas di bangku, dorong pinggul sampai lurus.',
  },
  { id: 'curl', name: 'Biceps curl', kind: 'weighted', incrementKg: 1, cue: 'Siku diam di samping badan.' },
  {
    id: 'pushdown',
    name: 'Triceps pushdown',
    kind: 'weighted',
    incrementKg: 2.5,
    cue: 'Siku menempel badan, luruskan penuh.',
  },
  {
    id: 'lunge',
    name: 'Dumbbell lunge',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Langkah panjang, lutut belakang hampir menyentuh lantai. Repetisi per kaki.',
  },
  {
    id: 'goblet_squat',
    name: 'Goblet squat',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Pegang dumbbell di depan dada, turun sedalam nyaman.',
  },
  {
    id: 'db_row',
    name: 'Dumbbell row',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Satu tangan bertumpu, tarik dumbbell ke pinggang. Repetisi per sisi.',
  },
  {
    id: 'db_rdl',
    name: 'Dumbbell Romanian deadlift',
    kind: 'weighted',
    incrementKg: 2,
    cue: 'Dorong pinggul ke belakang, dumbbell dekat kaki.',
  },
  {
    id: 'pushup',
    name: 'Push-up',
    kind: 'bodyweight',
    cue: 'Badan lurus dari kepala ke tumit. Terlalu berat? Tangan di meja.',
  },
  {
    id: 'pike_pushup',
    name: 'Pike push-up',
    kind: 'bodyweight',
    cue: 'Pinggul tinggi, kepala turun di antara tangan.',
  },
  {
    id: 'glute_bridge',
    name: 'Glute bridge',
    kind: 'bodyweight',
    cue: 'Berbaring, dorong pinggul ke atas, tahan 1 detik.',
  },
  { id: 'plank', name: 'Plank', kind: 'time', cue: 'Siku di bawah bahu, badan lurus, perut dikencangkan.' },
];
export const LIFT = Object.fromEntries(LIFTS.map((l) => [l.id, l])) as Record<string, Lift>;

export interface Prescription {
  lift: string;
  sets: number;
  /** Reps for rep-based lifts, seconds for timed holds. */
  min: number;
  max: number;
}

export interface StrengthProgram {
  id: string;
  name: string;
  level: string;
  equipment: string;
  daysPerWeek: number;
  description: string;
  /** Rotated in order by completed sessions, so a missed day never skips one. */
  sessions: { key: string; title: string; exercises: Prescription[] }[];
}

const p = (lift: string, sets: number, min: number, max: number): Prescription => ({ lift, sets, min, max });

export const PROGRAMS: StrengthProgram[] = [
  {
    id: 'fb3_gym',
    name: 'Full body 3x',
    level: 'Pemula',
    equipment: 'Gym',
    daysPerWeek: 3,
    description: 'Seluruh tubuh tiap sesi, bergantian A dan B. Paling efektif untuk mulai dan untuk recomp.',
    sessions: [
      {
        key: 'A',
        title: 'Full body A',
        exercises: [p('squat', 3, 6, 10), p('bench', 3, 6, 10), p('row', 3, 8, 12), p('plank', 3, 30, 60)],
      },
      {
        key: 'B',
        title: 'Full body B',
        exercises: [p('rdl', 3, 8, 10), p('ohp', 3, 6, 10), p('pulldown', 3, 8, 12), p('lunge', 3, 8, 12)],
      },
    ],
  },
  {
    id: 'fb3_home',
    name: 'Full body 3x di rumah',
    level: 'Pemula',
    equipment: 'Dumbbell atau tanpa alat',
    daysPerWeek: 3,
    description: 'Versi rumahan: sepasang dumbbell dan berat badan sendiri.',
    sessions: [
      {
        key: 'A',
        title: 'Rumah A',
        exercises: [
          p('goblet_squat', 3, 8, 15),
          p('pushup', 3, 6, 15),
          p('db_row', 3, 8, 12),
          p('plank', 3, 20, 60),
        ],
      },
      {
        key: 'B',
        title: 'Rumah B',
        exercises: [
          p('db_rdl', 3, 8, 12),
          p('pike_pushup', 3, 5, 12),
          p('lunge', 3, 8, 12),
          p('glute_bridge', 3, 12, 20),
        ],
      },
    ],
  },
  {
    id: 'ul4_gym',
    name: 'Upper/Lower 4x',
    level: 'Menengah',
    equipment: 'Gym',
    daysPerWeek: 4,
    description: 'Atas dan bawah bergantian. Untuk yang sudah rutin latihan minimal 3 bulan.',
    sessions: [
      {
        key: 'UA',
        title: 'Upper A',
        exercises: [
          p('bench', 4, 6, 8),
          p('row', 4, 6, 10),
          p('ohp', 3, 8, 10),
          p('pulldown', 3, 10, 12),
          p('curl', 2, 10, 15),
        ],
      },
      {
        key: 'LA',
        title: 'Lower A',
        exercises: [
          p('squat', 4, 6, 8),
          p('rdl', 3, 8, 10),
          p('leg_press', 3, 10, 12),
          p('leg_curl', 3, 10, 12),
          p('calf_raise', 3, 12, 15),
        ],
      },
      {
        key: 'UB',
        title: 'Upper B',
        exercises: [
          p('incline_db', 4, 8, 10),
          p('pullup', 4, 5, 10),
          p('db_shoulder', 3, 8, 12),
          p('db_row', 3, 8, 12),
          p('pushdown', 2, 10, 15),
        ],
      },
      {
        key: 'LB',
        title: 'Lower B',
        exercises: [
          p('deadlift', 3, 4, 6),
          p('split_squat', 3, 8, 10),
          p('hip_thrust', 3, 8, 12),
          p('plank', 3, 30, 60),
        ],
      },
    ],
  },
];
export const PROGRAM = Object.fromEntries(PROGRAMS.map((x) => [x.id, x])) as Record<string, StrengthProgram>;

export interface RunWeek {
  /** Run/walk intervals; absent for a continuous run. */
  intervals?: { runMin: number; walkMin: number; rounds: number };
  durationMin: number;
  note: string;
}

export interface RunPlan {
  id: string;
  name: string;
  level: string;
  daysPerWeek: number;
  description: string;
  /** One entry per week; after the last week the last one repeats. */
  weeks: RunWeek[];
}

const iv = (runMin: number, walkMin: number, rounds: number): RunWeek => ({
  intervals: { runMin, walkMin, rounds },
  durationMin: (runMin + walkMin) * rounds,
  note: `${rounds}× (lari ${runMin} menit + jalan ${walkMin} menit)`,
});
const easy = (durationMin: number): RunWeek => ({
  durationMin,
  note: `Lari santai ${durationMin} menit, pace yang masih bisa sambil ngobrol`,
});

export const RUN_PLANS: RunPlan[] = [
  {
    id: 'start_run',
    name: 'Mulai lari',
    level: 'Pemula',
    daysPerWeek: 3,
    description: '8 minggu dari jalan-lari sampai lari 30 menit tanpa berhenti.',
    weeks: [
      iv(1, 2, 8),
      iv(2, 2, 6),
      iv(3, 2, 5),
      iv(5, 2, 4),
      iv(8, 2, 3),
      iv(12, 2, 2),
      easy(20),
      easy(30),
    ],
  },
  {
    id: 'easy_run',
    name: 'Lari santai (zona 2)',
    level: 'Semua level',
    daysPerWeek: 2,
    description: 'Lari pelan untuk jantung dan bakar lemak, durasi naik ±10% per minggu sampai 45 menit.',
    weeks: [20, 22, 25, 27, 30, 33, 36, 40, 45].map(easy),
  },
];
export const RUN_PLAN = Object.fromEntries(RUN_PLANS.map((x) => [x.id, x])) as Record<string, RunPlan>;
