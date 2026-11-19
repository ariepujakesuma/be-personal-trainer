import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AiFailedError, AiService } from '../ai/ai.service';
import { EXERCISE_SYSTEM_PROMPT } from '../ai/prompts';
import { exerciseParseSchema } from '../ai/schemas';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { dayRange, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { WeightModule, WeightService } from '../weight/weight.module';
import { DEFAULT_MET, caloriesBurned } from './met';

const exerciseSchema = z
  .object({
    exerciseTypeId: z.coerce.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    rawText: z.string().max(500).nullable().optional(),
    durationMin: z.coerce.number().int().min(1).max(600),
    intensity: z.enum(['light', 'moderate', 'vigorous']).default('moderate'),
    distanceKm: z.coerce.number().positive().max(500).nullable().optional(),
    detail: z.record(z.string(), z.unknown()).nullable().optional(),
    performedAt: z.iso.datetime({ offset: true }).optional(),
    source: z.enum(['manual', 'ai_parsed']).default('manual'),
  })
  .refine((v) => v.exerciseTypeId || v.name, 'Pilih jenis olahraga atau isi nama');
type ExerciseInput = z.infer<typeof exerciseSchema>;

const parseSchema = z.object({ text: z.string().trim().min(3).max(500) });

@Injectable()
export class ExerciseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weights: WeightService,
    private readonly ai: AiService,
  ) {}

  async calories(
    userId: string,
    typeId: number | null | undefined,
    intensity: ExerciseInput['intensity'],
    durationMin: number,
  ) {
    const weight = await this.weights.latest(userId);
    if (!weight) throw new BadRequestException('Isi berat badan dulu untuk menghitung kalori olahraga');
    const type = typeId ? await this.prisma.exerciseType.findUnique({ where: { id: typeId } }) : null;
    if (typeId && !type) throw new BadRequestException('Jenis olahraga tidak ditemukan');
    return {
      type,
      kcal: caloriesBurned(type?.metValue ?? DEFAULT_MET, intensity, weight.weightKg, durationMin),
    };
  }

  async parse(user: AuthUser, text: string) {
    const types = await this.prisma.exerciseType.findMany({ orderBy: { name: 'asc' } });
    try {
      const { data } = await this.ai.chatJson({
        feature: 'exercise_parse',
        model: this.ai.textModel,
        userId: user.id,
        schema: exerciseParseSchema,
        messages: [
          { role: 'system', content: EXERCISE_SYSTEM_PROMPT(types.map((t) => t.name)) },
          { role: 'user', content: text },
        ],
      });
      const match = types.find((t) => t.name.toLowerCase() === data.matched_type?.toLowerCase()) ?? null;
      const { kcal } = await this.calories(user.id, match?.id, data.intensity, data.duration_min);
      return {
        exerciseTypeId: match?.id ?? null,
        name: data.name,
        rawText: text,
        durationMin: data.duration_min,
        intensity: data.intensity,
        distanceKm: data.distance_km ?? null,
        detail: data.detail ?? null,
        caloriesBurned: kcal,
        source: 'ai_parsed' as const,
      };
    } catch (err) {
      if (err instanceof AiFailedError) {
        throw new ServiceUnavailableException('AI belum bisa membaca teks ini. Isi manual dulu ya.');
      }
      throw err;
    }
  }
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ExerciseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly service: ExerciseService,
  ) {}

  @Get('exercise-types')
  types() {
    return this.prisma.exerciseType.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  @Post('exercises/parse')
  @HttpCode(200)
  parse(@CurrentUser() user: AuthUser, @Body(new ZodPipe(parseSchema)) body: z.infer<typeof parseSchema>) {
    return this.service.parse(user, body.text);
  }

  @Post('exercises')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(exerciseSchema)) body: ExerciseInput) {
    const { type, kcal } = await this.service.calories(
      user.id,
      body.exerciseTypeId,
      body.intensity,
      body.durationMin,
    );
    return this.prisma.exerciseLog.create({
      data: {
        userId: user.id,
        exerciseTypeId: type?.id ?? null,
        name: body.name ?? type!.name,
        rawText: body.rawText ?? null,
        durationMin: body.durationMin,
        intensity: body.intensity,
        distanceKm: body.distanceKm ?? null,
        detailJson: (body.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        caloriesBurned: kcal,
        source: body.source,
        performedAt: body.performedAt ? new Date(body.performedAt) : new Date(),
      },
    });
  }

  @Get('exercises')
  list(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = date ?? localDate(user.timezone);
    if (!isDateString(day)) throw new BadRequestException('Format tanggal YYYY-MM-DD');
    const { start, end } = dayRange(day, user.timezone);
    return this.prisma.exerciseLog.findMany({
      where: { userId: user.id, performedAt: { gte: start, lt: end } },
      orderBy: { performedAt: 'asc' },
    });
  }

  @Put('exercises/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(exerciseSchema)) body: ExerciseInput,
  ) {
    await this.own(user.id, id);
    const { type, kcal } = await this.service.calories(
      user.id,
      body.exerciseTypeId,
      body.intensity,
      body.durationMin,
    );
    return this.prisma.exerciseLog.update({
      where: { id },
      data: {
        exerciseTypeId: type?.id ?? null,
        name: body.name ?? type!.name,
        durationMin: body.durationMin,
        intensity: body.intensity,
        distanceKm: body.distanceKm ?? null,
        detailJson: (body.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        caloriesBurned: kcal,
        ...(body.performedAt ? { performedAt: new Date(body.performedAt) } : {}),
      },
    });
  }

  @Delete('exercises/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user.id, id);
    await this.prisma.exerciseLog.delete({ where: { id } });
  }

  private async own(userId: string, id: string) {
    const log = await this.prisma.exerciseLog.findFirst({ where: { id, userId } });
    if (!log) throw new NotFoundException('Log olahraga tidak ditemukan');
    return log;
  }
}

@Module({ imports: [WeightModule], controllers: [ExerciseController], providers: [ExerciseService] })
export class ExerciseModule {}
