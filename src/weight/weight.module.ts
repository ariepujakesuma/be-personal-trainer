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

const weightSchema = z.object({
  date: dateStr.optional(),
  weightKg: z.coerce.number().min(25).max(350),
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

  async upsert(userId: string, date: string, weightKg: number) {
    return this.prisma.weightLog.upsert({
      where: { userId_date: { userId, date: dateOnly(date) } },
      create: { userId, date: dateOnly(date), weightKg },
      update: { weightKg },
    });
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
    return this.weights.upsert(user.id, body.date ?? localDate(user.timezone), body.weightKg);
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
