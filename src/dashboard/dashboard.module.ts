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
import { dateOnly, dayRange, isDateString, localDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async day(userId: string, timeZone: string, date: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil belum diisi');
    const { start, end } = dayRange(date, timeZone);

    const [meals, exercises, weight, summary] = await Promise.all([
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
}

@Module({ controllers: [DashboardController], providers: [DashboardService], exports: [DashboardService] })
export class DashboardModule {}
