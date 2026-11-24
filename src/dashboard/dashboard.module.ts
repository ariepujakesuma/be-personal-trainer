import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { addDays, ageOn, dateOnly, dayRange, isDateString, localDate } from '../common/dates';
import { ACTIVITY_FACTOR, bmr } from '../profile/targets';
import { PrismaService } from '../prisma/prisma.service';

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async day(userId: string, timeZone: string, date: string) {
    const { start, end } = dayRange(date, timeZone);
    // One round of parallel queries: each round trip to the database costs the most here.
    const [profile, meals, exercises, weight, summary] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.meal.findMany({
        where: { userId, eatenAt: { gte: start, lt: end } },
        include: { items: true },
        omit: { aiRawJson: true },
        orderBy: { eatenAt: 'asc' },
      }),
      this.prisma.exerciseLog.findMany({
        where: { userId, performedAt: { gte: start, lt: end } },
        orderBy: { performedAt: 'asc' },
      }),
      this.prisma.weightLog.findUnique({ where: { userId_date: { userId, date: dateOnly(date) } } }),
      this.prisma.dailySummary.findUnique({ where: { userId_date: { userId, date: dateOnly(date) } } }),
    ]);
    if (!profile) throw new NotFoundException('Profil belum diisi');

    const confirmed = meals.filter((m) => m.status === 'confirmed');
    const intake = {
      calories: confirmed.reduce((s, m) => s + m.totalCalories, 0),
      proteinG: round1(confirmed.reduce((s, m) => s + m.proteinG, 0)),
      carbsG: round1(confirmed.reduce((s, m) => s + m.carbsG, 0)),
      fatG: round1(confirmed.reduce((s, m) => s + m.fatG, 0)),
    };
    const burn = exercises.reduce((s, e) => s + e.caloriesBurned, 0);

    return {
      date,
      goal: profile.goal,
      targets: {
        calories: profile.targetCalories,
        proteinG: profile.targetProteinG,
        carbsG: profile.targetCarbsG,
        fatG: profile.targetFatG,
      },
      intake,
      burn,
      net: intake.calories - burn,
      remaining: profile.targetCalories - intake.calories + burn,
      meals,
      exercises,
      weightKg: weight?.weightKg ?? null,
      weight,
      hasSummary: Boolean(summary),
      hasAnyLog: meals.length > 0 || exercises.length > 0 || Boolean(weight),
    };
  }

  /**
   * Inputs for the weight projection. Averages cover the last 7 complete days (today is
   * still being logged). Intake is averaged over days that have confirmed meals, since an
   * unlogged day is unknown, not zero; exercise is averaged over all 7 days.
   */
  async projection(userId: string, timeZone: string) {
    const today = localDate(timeZone);
    const start = dayRange(addDays(today, -7), timeZone).start;
    const end = dayRange(today, timeZone).start;

    const [profile, weight, comp, meals, burn] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.weightLog.findFirst({ where: { userId }, orderBy: { date: 'desc' } }),
      this.prisma.weightLog.findFirst({
        where: { userId, bodyFatPct: { not: null } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.meal.findMany({
        where: { userId, status: 'confirmed', eatenAt: { gte: start, lt: end } },
        select: { eatenAt: true, totalCalories: true },
      }),
      this.prisma.exerciseLog.aggregate({
        where: { userId, performedAt: { gte: start, lt: end } },
        _sum: { caloriesBurned: true },
      }),
    ]);
    if (!profile) throw new NotFoundException('Profil belum diisi');

    const loggedDays = new Set(meals.map((m) => localDate(timeZone, m.eatenAt))).size;
    const missing: ('bodyComposition' | 'meals')[] = [];
    if (!comp) missing.push('bodyComposition');
    if (loggedDays === 0) missing.push('meals');

    const age = ageOn(profile.birthDate, today);
    const weightKg = weight?.weightKg ?? null;
    const tdee =
      weightKg == null
        ? null
        : bmr({ sex: profile.sex, age, heightCm: profile.heightCm, weightKg }) *
          ACTIVITY_FACTOR[profile.activityLevel];

    return {
      ready: missing.length === 0,
      missing,
      sex: profile.sex,
      age,
      heightCm: profile.heightCm,
      activityFactor: ACTIVITY_FACTOR[profile.activityLevel],
      weightKg,
      weightDate: weight?.date.toISOString().slice(0, 10) ?? null,
      bodyFatPct: comp?.bodyFatPct ?? null,
      bodyFatDate: comp?.date.toISOString().slice(0, 10) ?? null,
      loggedDays,
      avgIntake: loggedDays ? Math.round(meals.reduce((s, m) => s + m.totalCalories, 0) / loggedDays) : null,
      avgBurn: Math.round((burn._sum.caloriesBurned ?? 0) / 7),
      targetCalories: profile.targetCalories,
      targetDeficit: tdee == null ? null : Math.round(tdee - profile.targetCalories),
      targetProteinG: profile.targetProteinG,
      targetWeightKg: profile.targetWeightKg,
    };
  }
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('daily')
  daily(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = date ?? localDate(user.timezone);
    if (!isDateString(day)) throw new BadRequestException('Format tanggal YYYY-MM-DD');
    return this.dashboard.day(user.id, user.timezone, day);
  }

  @Get('projection')
  projection(@CurrentUser() user: AuthUser) {
    return this.dashboard.projection(user.id, user.timezone);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService], exports: [DashboardService] })
export class DashboardModule {}
