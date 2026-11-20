import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { addDays, dateOnly, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const dateStr = z.string().refine(isDateString, 'Format tanggal YYYY-MM-DD');

/** Optional smart-scale readings, entered manually. `null` clears a value. */
const metric = (min: number, max: number, int = false) => {
  const n = z.coerce
    .number({ error: 'Harus berupa angka' })
    .min(min, `Minimal ${min}`)
    .max(max, `Maksimal ${max}`);
  return (int ? n.int('Harus bilangan bulat') : n).nullable().optional();
};

export const bodyCompSchema = z.object({
  bmi: metric(10, 80),
  bodyFatPct: metric(2, 75),
  visceralFat: metric(1, 60),
  muscleKg: metric(5, 150),
  waterPct: metric(20, 80),
  obesityDegreePct: metric(-60, 200),
  bmrKcal: metric(500, 5000, true),
  metabolicAge: metric(10, 100, true),
  leanMassKg: metric(10, 250),
  proteinPct: metric(3, 35),
  boneMassKg: metric(0.5, 10),
});
export type BodyComp = z.infer<typeof bodyCompSchema>;
export const BODY_COMP_FIELDS = Object.keys(bodyCompSchema.shape) as (keyof BodyComp)[];

const weightSchema = bodyCompSchema.extend({
  date: dateStr.optional(),
  weightKg: z.coerce.number().min(25).max(350),
});

const importSchema = z.object({
  rows: z
    .array(bodyCompSchema.extend({ date: dateStr, weightKg: z.coerce.number().min(25).max(350) }))
    .min(1, 'Tidak ada baris untuk diimpor')
    .max(1000, 'Maksimal 1.000 baris sekali impor'),
});

@Injectable()
export class WeightService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest weight on or before `date`. */
  async latest(userId: string, date?: string) {
    return this.prisma.weightLog.findFirst({
      where: { userId, ...(date ? { date: { lte: dateOnly(date) } } : {}) },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * `bodyComp` undefined leaves stored readings untouched (e.g. weight set from the profile form);
   * when given, every reading is written, so a blank field clears it.
   */
  async upsert(userId: string, date: string, weightKg: number, bodyComp?: BodyComp) {
    const comp = bodyComp ? Object.fromEntries(BODY_COMP_FIELDS.map((k) => [k, bodyComp[k] ?? null])) : {};
    return this.prisma.weightLog.upsert({
      where: { userId_date: { userId, date: dateOnly(date) } },
      create: { userId, date: dateOnly(date), weightKg, ...comp },
      update: { weightKg, ...comp },
    });
  }

  /**
   * Imported rows only set the readings the file has; readings already stored for that day
   * and missing from the file are kept.
   */
  async importRows(userId: string, rows: z.infer<typeof importSchema>['rows']) {
    await this.prisma.$transaction(
      rows.map(({ date, weightKg, ...comp }) => {
        const given = Object.fromEntries(
          BODY_COMP_FIELDS.filter((k) => comp[k] != null).map((k) => [k, comp[k]]),
        );
        return this.prisma.weightLog.upsert({
          where: { userId_date: { userId, date: dateOnly(date) } },
          create: { userId, date: dateOnly(date), weightKg, ...given },
          update: { weightKg, ...given },
        });
      }),
    );
    return { imported: rows.length };
  }
}

@Controller('weights')
@UseGuards(JwtAuthGuard)
export class WeightController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weights: WeightService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(weightSchema)) body: z.infer<typeof weightSchema>) {
    const { date, weightKg, ...bodyComp } = body;
    return this.weights.upsert(user.id, date ?? localDate(user.timezone), weightKg, bodyComp);
  }

  @Post('import')
  import(@CurrentUser() user: AuthUser, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>) {
    return this.weights.importRows(user.id, body.rows);
  }

  /** Most recent day with any body-composition reading, whatever its date. */
  @Get('composition/latest')
  async latestComposition(@CurrentUser() user: AuthUser) {
    const log = await this.prisma.weightLog.findFirst({
      where: { userId: user.id, OR: BODY_COMP_FIELDS.map((k) => ({ [k]: { not: null } })) },
      orderBy: { date: 'desc' },
    });
    return { log };
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const end = to ?? localDate(user.timezone);
    const start = from ?? addDays(end, -89);
    if (!isDateString(start) || !isDateString(end))
      throw new BadRequestException('Format tanggal YYYY-MM-DD');
    return this.prisma.weightLog.findMany({
      where: { userId: user.id, date: { gte: dateOnly(start), lte: dateOnly(end) } },
      orderBy: { date: 'asc' },
    });
  }
}

@Module({ controllers: [WeightController], providers: [WeightService], exports: [WeightService] })
export class WeightModule {}
