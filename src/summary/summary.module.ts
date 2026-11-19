import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiFailedError, AiService } from '../ai/ai.service';
import { SUMMARY_SYSTEM_PROMPT } from '../ai/prompts';
import { dailySummarySchema } from '../ai/schemas';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { dateOnly, isDateString, localDate } from '../common/dates';
import { DashboardModule, DashboardService } from '../dashboard/dashboard.module';
import { PrismaService } from '../prisma/prisma.service';

const MEAL_LABEL = {
  breakfast: 'Sarapan',
  lunch: 'Makan siang',
  dinner: 'Makan malam',
  snack: 'Snack',
} as const;

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly ai: AiService,
  ) {}

  async generate(user: { id: string; timezone: string }, date: string) {
    const day = await this.dashboard.day(user.id, user.timezone, date);
    if (!day.hasAnyLog) throw new BadRequestException('Belum ada log di tanggal ini');

    // Aggregates only, no photos: keeps tokens low (PRD section AI).
    const input = {
      tanggal: date,
      goal: day.goal,
      target: day.targets,
      asupan: day.intake,
      kalori_olahraga: day.burn,
      net_kalori: day.net,
      sisa_kalori: day.remaining,
      berat_kg: day.weightKg,
      makanan: day.meals
        .filter((m) => m.status === 'confirmed')
        .map((m) => ({
          waktu: MEAL_LABEL[m.mealType],
          kalori: m.totalCalories,
          protein_g: m.proteinG,
          item: m.items.map((i) => i.name),
        })),
      olahraga: day.exercises.map((e) => ({
        nama: e.name,
        durasi_menit: e.durationMin,
        intensitas: e.intensity,
        kalori: e.caloriesBurned,
      })),
    };

    let result;
    try {
      result = await this.ai.chatJson({
        feature: 'daily_summary',
        model: this.ai.textModel,
        userId: user.id,
        schema: dailySummarySchema,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
      });
    } catch (err) {
      if (err instanceof AiFailedError)
        throw new ServiceUnavailableException('AI sedang tidak tersedia, coba lagi sebentar lagi');
      throw err;
    }

    const data = {
      intakeKcal: day.intake.calories,
      burnKcal: day.burn,
      netKcal: day.net,
      aiJson: result.data as Prisma.InputJsonValue,
      aiModel: result.model,
      generatedAt: new Date(),
    };
    return this.prisma.dailySummary.upsert({
      where: { userId_date: { userId: user.id, date: dateOnly(date) } },
      create: { userId: user.id, date: dateOnly(date), ...data },
      update: data,
    });
  }
}

@Controller('summaries')
@UseGuards(JwtAuthGuard)
export class SummaryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
  ) {}

  @Get('daily')
  async get(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = this.day(user, date);
    const summary = await this.prisma.dailySummary.findUnique({
      where: { userId_date: { userId: user.id, date: dateOnly(day) } },
    });
    return { date: day, summary };
  }

  @Post('daily/generate')
  @HttpCode(200)
  async generate(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = this.day(user, date);
    return { date: day, summary: await this.summaries.generate(user, day) };
  }

  private day(user: AuthUser, date?: string) {
    const day = date ?? localDate(user.timezone);
    if (!isDateString(day)) throw new BadRequestException('Format tanggal YYYY-MM-DD');
    return day;
  }
}

@Module({
  imports: [DashboardModule],
  controllers: [SummaryController],
  providers: [SummaryService],
  exports: [SummaryService],
})
export class SummaryModule {}
