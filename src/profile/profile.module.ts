import { Body, Controller, Get, Module, NotFoundException, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { ageOn, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { WeightModule, WeightService } from '../weight/weight.module';
import { computeTargets } from './targets';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sex: z.enum(['male', 'female']),
  birthDate: z.string().refine(isDateString, 'Format tanggal YYYY-MM-DD'),
  heightCm: z.coerce.number().min(100).max(250),
  weightKg: z.coerce.number().min(25).max(350).optional(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  goal: z.enum(['recomp', 'lose', 'maintain', 'gain']).default('recomp'),
  emailReminderEnabled: z.boolean().optional(),
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
    };
    await this.prisma.profile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return this.get({ ...user, name: body.name ?? user.name });
  }
}

@Module({ imports: [WeightModule], controllers: [ProfileController] })
export class ProfileModule {}
