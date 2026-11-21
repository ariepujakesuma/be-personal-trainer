import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiFailedError, AiModule, AiService } from '../ai/ai.service';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { addDays, dateOnly, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SCAN_SYSTEM_PROMPT, normalizeScan, scanSchema } from './scan';

const dateStr = z.string().refine(isDateString, 'Format tanggal YYYY-MM-DD');

export { BODY_COMP_FIELDS, bodyCompSchema, type BodyComp } from './body-comp';
import { BODY_COMP_FIELDS, bodyCompSchema, type BodyComp } from './body-comp';

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
    private readonly ai: AiService,
  ) {}

  /**
   * Reads a scale app's screenshot into the form's fields. Nothing is saved: the user checks
   * the filled form and saves it. The image is not stored either.
   */
  @Post('scan')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 6 * 1024 * 1024 } }))
  async scan(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file || !file.mimetype.startsWith('image/'))
      throw new BadRequestException('Kirim screenshot berupa gambar');
    try {
      const { data, model } = await this.ai.chatJson({
        feature: 'body_comp_scan',
        model: this.ai.visionModel,
        userId: user.id,
        schema: scanSchema,
        messages: [
          { role: 'system', content: SCAN_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
              },
            ],
          },
        ],
      });
      const result = normalizeScan(data);
      if (result.weightKg == null && !Object.keys(result.values).length)
        throw new UnprocessableEntityException('Tidak ada angka komposisi tubuh yang terbaca di gambar ini');
      return { ...result, model };
    } catch (err) {
      if (err instanceof AiFailedError)
        throw new UnprocessableEntityException('Gambar tidak bisa dibaca. Coba screenshot yang lebih jelas.');
      throw err;
    }
  }

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

@Module({
  imports: [AiModule],
  controllers: [WeightController],
  providers: [WeightService],
  exports: [WeightService],
})
export class WeightModule {}
