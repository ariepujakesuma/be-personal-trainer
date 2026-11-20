import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { addDays, ageOn, dayRange, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { WeightModule, WeightService } from '../weight/weight.module';
import { CALIBRATION_WINDOW_DAYS, calibrate } from './calibration';
import { ACTIVITY_FACTOR, bmr, computeTargets } from './targets';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sex: z.enum(['male', 'female']),
  birthDate: z.string().refine(isDateString, 'Format tanggal YYYY-MM-DD'),
  heightCm: z.coerce.number().min(100).max(250),
  weightKg: z.coerce.number().min(25).max(350).optional(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  goal: z.enum(['recomp', 'lose', 'maintain', 'gain']).default('recomp'),
  emailReminderEnabled: z.boolean().optional(),
  targetWeightKg: z.coerce.number().min(25).max(350).nullable().optional(),
  targets: z
    .object({
      calories: z.coerce.number().int().min(800).max(6000),
      proteinG: z.coerce.number().int().min(0).max(500),
      carbsG: z.coerce.number().int().min(0).max(1000),
      fatG: z.coerce.number().int().min(0).max(400),
    })
    .nullable()
    .optional(),
});
type ProfileInput = z.infer<typeof profileSchema>;

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weights: WeightService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Profil belum diisi');
    const today = localDate(user.timezone);
    const weight = await this.weights.latest(user.id, today);
    const suggested = weight
      ? computeTargets({
          sex: profile.sex,
          age: ageOn(profile.birthDate, today),
          heightCm: profile.heightCm,
          weightKg: weight.weightKg,
          activityLevel: profile.activityLevel,
          goal: profile.goal,
        })
      : null;
    return {
      user,
      profile: { ...profile, birthDate: profile.birthDate.toISOString().slice(0, 10) },
      latestWeightKg: weight?.weightKg ?? null,
      suggested,
    };
  }

  @Put()
  async upsert(@CurrentUser() user: AuthUser, @Body(new ZodPipe(profileSchema)) body: ProfileInput) {
    const today = localDate(user.timezone);
    if (body.weightKg) await this.weights.upsert(user.id, today, body.weightKg);
    const weight = await this.weights.latest(user.id, today);
    if (!weight) throw new NotFoundException('Isi berat badan dulu untuk menghitung target');
    if (body.name) await this.prisma.user.update({ where: { id: user.id }, data: { name: body.name } });

    const computed = computeTargets({
      sex: body.sex,
      age: ageOn(new Date(`${body.birthDate}T00:00:00Z`), today),
      heightCm: body.heightCm,
      weightKg: weight.weightKg,
      activityLevel: body.activityLevel,
      goal: body.goal,
    });
    const t = body.targets ?? {
      calories: computed.calories,
      proteinG: computed.proteinG,
      carbsG: computed.carbsG,
      fatG: computed.fatG,
    };
    const data = {
      sex: body.sex,
      birthDate: new Date(`${body.birthDate}T00:00:00Z`),
      heightCm: body.heightCm,
      activityLevel: body.activityLevel,
      goal: body.goal,
      targetCalories: t.calories,
      targetProteinG: t.proteinG,
      targetCarbsG: t.carbsG,
      targetFatG: t.fatG,
      targetsOverridden: Boolean(body.targets),
      ...(body.emailReminderEnabled !== undefined ? { emailReminderEnabled: body.emailReminderEnabled } : {}),
      ...(body.targetWeightKg !== undefined ? { targetWeightKg: body.targetWeightKg } : {}),
    };
    await this.prisma.profile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return this.get({ ...user, name: body.name ?? user.name });
  }

  /** Target calories suggested from the last 28 days of real intake and weight. */
  @Get('calibration')
  async calibration(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Profil belum diisi');
    const today = localDate(user.timezone);
    const from = addDays(today, -CALIBRATION_WINDOW_DAYS);
    const start = dayRange(from, user.timezone).start;
    const end = dayRange(today, user.timezone).start;

    const [meals, burn, weights, latest] = await Promise.all([
      this.prisma.meal.findMany({
        where: { userId: user.id, status: 'confirmed', eatenAt: { gte: start, lt: end } },
        select: { eatenAt: true, totalCalories: true },
      }),
      this.prisma.exerciseLog.aggregate({
        where: { userId: user.id, performedAt: { gte: start, lt: end } },
        _sum: { caloriesBurned: true },
      }),
      this.prisma.weightLog.findMany({
        where: {
          userId: user.id,
          date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
        },
        select: { date: true, weightKg: true },
      }),
      this.weights.latest(user.id, today),
    ]);
    if (!latest) throw new NotFoundException('Isi berat badan dulu');

    const perDay = new Map<string, number>();
    for (const m of meals) {
      const d = localDate(user.timezone, m.eatenAt);
      perDay.set(d, (perDay.get(d) ?? 0) + m.totalCalories);
    }
    const startMs = Date.parse(`${from}T00:00:00Z`);
    const formulaTdee =
      bmr({
        sex: profile.sex,
        age: ageOn(profile.birthDate, today),
        heightCm: profile.heightCm,
        weightKg: latest.weightKg,
      }) * ACTIVITY_FACTOR[profile.activityLevel];

    return calibrate({
      sex: profile.sex,
      goal: profile.goal,
      formulaTdee,
      currentTarget: profile.targetCalories,
      dailyIntake: [...perDay.values()],
      burnTotal: burn._sum.caloriesBurned ?? 0,
      weights: weights.map((w) => ({ day: (w.date.getTime() - startMs) / 86400000, kg: w.weightKg })),
    });
  }

  /** Uses the calibrated calories; protein stays, fat 25%, carbs take the rest. */
  @Post('calibration/apply')
  async applyCalibration(@CurrentUser() user: AuthUser) {
    const result = await this.calibration(user);
    if (result.status !== 'ready') throw new BadRequestException('Data belum cukup untuk kalibrasi');
    const profile = (await this.prisma.profile.findUnique({ where: { userId: user.id } }))!;
    const calories = result.suggestedCalories;
    const fatG = Math.round((calories * 0.25) / 9);
    const carbsG = Math.max(0, Math.round((calories - profile.targetProteinG * 4 - fatG * 9) / 4));
    await this.prisma.profile.update({
      where: { userId: user.id },
      data: { targetCalories: calories, targetFatG: fatG, targetCarbsG: carbsG, targetsOverridden: true },
    });
    return this.get(user);
  }
}

@Module({ imports: [WeightModule], controllers: [ProfileController] })
export class ProfileModule {}
