import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { addDays, dayRange, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { caloriesBurned } from '../exercise/met';
import { PrismaService } from '../prisma/prisma.service';
import { WeightModule, WeightService } from '../weight/weight.module';
import { LIFT, LIFTS, PROGRAM, PROGRAMS, RUN_PLAN, RUN_PLANS } from './catalog';
import { nextTarget, runMet, weeklyKmTarget, type SetLog } from './progression';

const dateStr = z.string().refine(isDateString, 'Format tanggal YYYY-MM-DD');
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

const planSchema = z.object({
  strength: z
    .object({ programId: z.string().refine((id) => id in PROGRAM, 'Program tidak dikenal'), days: weekdays })
    .nullable(),
  run: z
    .object({
      planId: z.string().refine((id) => id in RUN_PLAN, 'Program lari tidak dikenal'),
      days: weekdays,
    })
    .nullable(),
});
type PlanInput = z.infer<typeof planSchema>;
/** Stored on the profile; `startDate` anchors the running plan's week count. */
type Plan = PlanInput & { startDate: string };

const strengthSchema = z.object({
  date: dateStr.optional(),
  programId: z.string(),
  sessionKey: z.string(),
  durationMin: z.coerce.number().int().min(5).max(300),
  exercises: z
    .array(
      z.object({
        lift: z.string().refine((id) => id in LIFT, 'Gerakan tidak dikenal'),
        sets: z
          .array(
            z.object({
              value: z.coerce.number().min(0).max(600),
              weightKg: z.coerce.number().min(0).max(500).nullable().optional(),
            }),
          )
          .max(10),
      }),
    )
    .min(1)
    .max(12),
});

const runSchema = z.object({
  date: dateStr.optional(),
  durationMin: z.coerce.number().int().min(1).max(600),
  distanceKm: z.coerce.number().positive().max(200).nullable().optional(),
  planId: z.string().nullable().optional(),
  week: z.coerce.number().int().min(1).max(100).nullable().optional(),
});

interface StrengthDetail {
  kind: 'strength';
  programId: string;
  sessionKey: string;
  exercises: { lift: string; sets: SetLog[] }[];
}
interface RunDetail {
  kind: 'run';
  planId?: string | null;
  week?: number | null;
}
type Detail = StrengthDetail | RunDetail;

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** Monday of the week containing `date`. */
const monday = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

@Controller('training')
@UseGuards(JwtAuthGuard)
export class TrainingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weights: WeightService,
  ) {}

  @Get('catalog')
  catalog() {
    return { programs: PROGRAMS, runPlans: RUN_PLANS, lifts: LIFTS };
  }

  @Get('plan')
  async plan(@CurrentUser() user: AuthUser) {
    return { plan: await this.loadPlan(user.id) };
  }

  @Put('plan')
  async setPlan(@CurrentUser() user: AuthUser, @Body(new ZodPipe(planSchema)) body: PlanInput) {
    const prev = await this.loadPlan(user.id);
    const today = localDate(user.timezone);
    // A new running plan starts again at week 1; other edits keep the count.
    const startDate = prev && prev.run?.planId === body.run?.planId ? prev.startDate : today;
    const plan: Plan = { ...body, startDate };
    const res = await this.prisma.profile.updateMany({
      where: { userId: user.id },
      data: { trainingPlan: plan },
    });
    if (!res.count) throw new NotFoundException('Profil belum diisi');
    return { plan };
  }

  /** What to train on `date`, with a target for every exercise from the user's own history. */
  @Get('today')
  async today(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = date ?? localDate(user.timezone);
    if (!isDateString(day)) throw new BadRequestException('Format tanggal YYYY-MM-DD');
    const [plan, logs] = await Promise.all([
      this.loadPlan(user.id),
      this.history(user.id, user.timezone, addDays(day, -180), addDays(day, 1)),
    ]);
    if (!plan) return { date: day, plan: null };
    const onDay = logs.filter((l) => l.date === day);
    const before = logs.filter((l) => l.date < day);

    let strength = null;
    const program = plan.strength ? PROGRAM[plan.strength.programId] : null;
    if (plan.strength && program) {
      const doneLog = onDay.find((l) => l.detail.kind === 'strength' && l.detail.programId === program.id);
      const count = before.filter(
        (l) => l.detail.kind === 'strength' && l.detail.programId === program.id,
      ).length;
      const session = doneLog
        ? (program.sessions.find((s) => s.key === (doneLog.detail as StrengthDetail).sessionKey) ??
          program.sessions[0])
        : program.sessions[count % program.sessions.length];
      const strengthBefore = before.filter(
        (l): l is typeof l & { detail: StrengthDetail } => l.detail.kind === 'strength',
      );
      strength = {
        programId: program.id,
        programName: program.name,
        scheduled: plan.strength.days.includes(weekday(day)),
        done: Boolean(doneLog),
        logged: doneLog ? (doneLog.detail as StrengthDetail).exercises : null,
        sessionKey: session.key,
        title: session.title,
        exercises: session.exercises.map((rx) => {
          const lift = LIFT[rx.lift];
          const last = [...strengthBefore]
            .reverse()
            .find((l) =>
              l.detail.exercises.some((e) => e.lift === rx.lift && e.sets.some((s) => s.value > 0)),
            );
          const lastSets = last?.detail.exercises.find((e) => e.lift === rx.lift)?.sets ?? null;
          return {
            lift: lift.id,
            name: lift.name,
            kind: lift.kind,
            cue: lift.cue,
            min: rx.min,
            max: rx.max,
            last: last ? { date: last.date, sets: lastSets } : null,
            target: nextTarget(lift, rx, lastSets),
          };
        }),
      };
    }

    let run = null;
    const runPlan = plan.run ? RUN_PLAN[plan.run.planId] : null;
    if (plan.run && runPlan) {
      const weekIdx = Math.max(
        0,
        Math.floor((Date.parse(day) - Date.parse(plan.startDate)) / (7 * 86400000)),
      );
      const week = runPlan.weeks[Math.min(weekIdx, runPlan.weeks.length - 1)];
      const runs = logs.filter((l) => l.detail.kind === 'run');
      const doneLog = onDay.find((l) => l.detail.kind === 'run');
      const mon = monday(day);
      const km = (from: string, to: string) =>
        Math.round(
          runs.filter((r) => r.date >= from && r.date < to).reduce((s, r) => s + (r.distanceKm ?? 0), 0) * 10,
        ) / 10;
      const thisWeekKm = km(mon, addDays(mon, 7));
      const lastWeekKm = km(addDays(mon, -7), mon);
      const lastRun = [...runs].reverse().find((r) => r.date < day) ?? null;
      run = {
        planId: runPlan.id,
        planName: runPlan.name,
        week: weekIdx + 1,
        totalWeeks: runPlan.weeks.length,
        scheduled: plan.run.days.includes(weekday(day)),
        done: Boolean(doneLog),
        logged: doneLog ? { durationMin: doneLog.durationMin, distanceKm: doneLog.distanceKm } : null,
        target: week,
        last: lastRun
          ? { date: lastRun.date, durationMin: lastRun.durationMin, distanceKm: lastRun.distanceKm }
          : null,
        thisWeekKm,
        lastWeekKm,
        weekKmTarget: weeklyKmTarget(lastWeekKm),
      };
    }

    const mon = monday(day);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      const w = weekday(d);
      const done = logs.filter((l) => l.date === d);
      return {
        date: d,
        strength: Boolean(plan.strength?.days.includes(w)),
        run: Boolean(plan.run?.days.includes(w)),
        strengthDone: done.some((l) => l.detail.kind === 'strength'),
        runDone: done.some((l) => l.detail.kind === 'run'),
      };
    });

    return { date: day, plan, strength, run, week };
  }

  @Post('strength')
  async logStrength(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(strengthSchema)) body: z.infer<typeof strengthSchema>,
  ) {
    const program = PROGRAM[body.programId];
    const session = program?.sessions.find((s) => s.key === body.sessionKey);
    if (!program || !session) throw new BadRequestException('Sesi latihan tidak dikenal');
    const exercises = body.exercises
      .map((e) => ({
        lift: e.lift,
        sets: e.sets
          .filter((s) => s.value > 0)
          .map((s) => ({ value: s.value, weightKg: s.weightKg ?? null })),
      }))
      .filter((e) => e.sets.length);
    if (!exercises.length) throw new BadRequestException('Isi minimal 1 set');

    const home = program.id.includes('home');
    const typeName = home ? 'Calisthenics' : 'Angkat beban';
    const detail: StrengthDetail = {
      kind: 'strength',
      programId: program.id,
      sessionKey: session.key,
      exercises,
    };
    return this.createLog(user, body.date, {
      typeName,
      name: session.title,
      durationMin: body.durationMin,
      met: null,
      intensity: 'vigorous',
      distanceKm: null,
      detail,
    });
  }

  @Post('run')
  async logRun(@CurrentUser() user: AuthUser, @Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    const detail: RunDetail = { kind: 'run', planId: body.planId ?? null, week: body.week ?? null };
    return this.createLog(user, body.date, {
      typeName: 'Lari',
      name: body.distanceKm ? `Lari ${String(body.distanceKm).replace('.', ',')} km` : 'Lari',
      durationMin: body.durationMin,
      met: runMet(body.distanceKm, body.durationMin),
      intensity: 'moderate',
      distanceKm: body.distanceKm ?? null,
      detail,
    });
  }

  private async createLog(
    user: AuthUser,
    date: string | undefined,
    x: {
      typeName: string;
      name: string;
      durationMin: number;
      met: number | null;
      intensity: 'moderate' | 'vigorous';
      distanceKm: number | null;
      detail: Detail;
    },
  ) {
    const weight = await this.weights.latest(user.id);
    if (!weight) throw new BadRequestException('Isi berat badan dulu untuk menghitung kalori olahraga');
    const type = await this.prisma.exerciseType.findUnique({ where: { name: x.typeName } });
    const today = localDate(user.timezone);
    const day = date ?? today;
    const performedAt =
      day === today ? new Date() : new Date(dayRange(day, user.timezone).start.getTime() + 12 * 3600000);
    return this.prisma.exerciseLog.create({
      data: {
        userId: user.id,
        exerciseTypeId: type?.id ?? null,
        name: x.name,
        durationMin: x.durationMin,
        intensity: x.intensity,
        distanceKm: x.distanceKm,
        detailJson: x.detail as unknown as Prisma.InputJsonValue,
        caloriesBurned: caloriesBurned(
          x.met ?? type?.metValue ?? 5,
          x.intensity,
          weight.weightKg,
          x.durationMin,
        ),
        source: 'manual',
        performedAt,
      },
    });
  }

  private async loadPlan(userId: string): Promise<Plan | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { trainingPlan: true },
    });
    return (profile?.trainingPlan as unknown as Plan | null) ?? null;
  }

  /** Training logs by local date. Plain "Lari"/"Jogging" logs from Catat olahraga count as runs. */
  private async history(userId: string, timeZone: string, from: string, to: string) {
    const logs = await this.prisma.exerciseLog.findMany({
      where: {
        userId,
        performedAt: { gte: dayRange(from, timeZone).start, lt: dayRange(to, timeZone).start },
      },
      orderBy: { performedAt: 'asc' },
      include: { exerciseType: { select: { name: true } } },
    });
    return logs.flatMap((l) => {
      const raw = l.detailJson as { kind?: string } | null;
      const isRun = ['Lari', 'Jogging'].includes(l.exerciseType?.name ?? '');
      const detail: Detail | null =
        raw?.kind === 'strength'
          ? (raw as StrengthDetail)
          : raw?.kind === 'run' || isRun
            ? { kind: 'run' }
            : null;
      if (!detail) return [];
      return [
        {
          date: localDate(timeZone, l.performedAt),
          durationMin: l.durationMin,
          distanceKm: l.distanceKm,
          detail,
        },
      ];
    });
  }
}

@Module({ imports: [WeightModule], controllers: [TrainingController] })
export class TrainingModule {}
