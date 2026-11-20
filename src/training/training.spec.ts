/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await -- test fixtures */
import { TrainingController } from './training.module';

const user = { id: 'u', email: 'a@b.co', name: 'A', timezone: 'Asia/Jakarta' };
const at = (date: string) => new Date(`${date}T05:00:00Z`); // 12:00 WIB

function setup(logs: object[], plan: object) {
  const prisma = {
    profile: { findUnique: async () => ({ trainingPlan: plan }) },
    exerciseLog: { findMany: async () => logs },
  };
  return new TrainingController(prisma as never, {} as never);
}

describe('training today', () => {
  const plan = {
    strength: { programId: 'fb3_gym', days: [1, 3, 5] },
    run: { planId: 'easy_run', days: [2, 6] },
    startDate: '2026-11-02',
  };

  it('rotates sessions by completed count and targets from last sets', async () => {
    const logs = [
      {
        performedAt: at('2026-11-16'),
        durationMin: 60,
        distanceKm: null,
        exerciseType: { name: 'Angkat beban' },
        detailJson: {
          kind: 'strength',
          programId: 'fb3_gym',
          sessionKey: 'A',
          exercises: [{ lift: 'squat', sets: [10, 10, 10].map((value) => ({ value, weightKg: 60 })) }],
        },
      },
      {
        performedAt: at('2026-11-17'),
        durationMin: 25,
        distanceKm: 4,
        exerciseType: { name: 'Lari' },
        detailJson: { kind: 'run' },
      },
      {
        performedAt: at('2026-11-12'),
        durationMin: 20,
        distanceKm: 3,
        exerciseType: { name: 'Jogging' },
        detailJson: null,
      },
    ];
    const res = (await setup(logs, plan).today(user, '2026-11-18')) as any;
    expect(res.strength.title).toBe('Full body B'); // A done once → B next
    expect(res.strength.scheduled).toBe(true); // Wednesday
    const res2 = (await setup(logs, plan).today(user, '2026-11-20')) as any;
    expect(res2.strength.title).toBe('Full body B');
    // Squat is in A: after 3×10 @ 60 the next A targets 65 kg.
    const nextA = (await setup(
      [
        ...logs,
        {
          ...logs[0],
          performedAt: at('2026-11-18'),
          detailJson: { ...logs[0].detailJson, sessionKey: 'B', exercises: [] },
        },
      ],
      plan,
    ).today(user, '2026-11-20')) as any;
    expect(nextA.strength.title).toBe('Full body A');
    expect(nextA.strength.exercises[0].target).toMatchObject({ weightKg: 65, value: 6 });
    expect(res.run).toMatchObject({ week: 3, thisWeekKm: 4, lastWeekKm: 3, weekKmTarget: 3.3 });
    expect(res.week).toHaveLength(7);
  });
});
