import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { get as getBlob, put as putBlob } from '@vercel/blob';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { AiFailedError, AiService, ChatMessage } from '../ai/ai.service';
import { FOOD_SYSTEM_PROMPT } from '../ai/prompts';
import { FoodAnalysis, foodAnalysisSchema } from '../ai/schemas';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { dayRange, isDateString, localDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

const analyzeSchema = z.object({
  mealType,
  text: z.string().trim().max(500).optional(),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
});

const itemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  portionDesc: z.string().trim().max(120).nullable().optional(),
  grams: z.coerce.number().min(0).max(5000),
  calories: z.coerce.number().int().min(0).max(10000),
  proteinG: z.coerce.number().min(0).max(1000),
  carbsG: z.coerce.number().min(0).max(1000),
  fatG: z.coerce.number().min(0).max(1000),
});

const updateSchema = z.object({
  mealType: mealType.optional(),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  items: z.array(itemSchema).max(30),
});
type UpdateInput = z.infer<typeof updateSchema>;

const repeatSchema = z.object({ mealType, eatenAt: z.iso.datetime({ offset: true }).optional() });
const favoriteSchema = z.object({ favorite: z.boolean() });

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Same foods, any portion order: "Nasi, Telur" and "telur, nasi" are one meal. */
const signature = (items: { name: string }[]) =>
  items
    .map((i) => i.name.trim().toLowerCase())
    .sort()
    .join('|');

function totals(items: { calories: number; proteinG: number; carbsG: number; fatG: number }[]) {
  return {
    totalCalories: Math.round(items.reduce((s, i) => s + i.calories, 0)),
    proteinG: round1(items.reduce((s, i) => s + i.proteinG, 0)),
    carbsG: round1(items.reduce((s, i) => s + i.carbsG, 0)),
    fatG: round1(items.reduce((s, i) => s + i.fatG, 0)),
  };
}

@Injectable()
export class MealService {
  private readonly logger = new Logger(MealService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {}

  async analyze(user: AuthUser, input: z.infer<typeof analyzeSchema>, file?: Express.Multer.File) {
    if (!file && !input.text) throw new BadRequestException('Kirim foto atau tulis makanannya');
    if (file && !file.mimetype.startsWith('image/'))
      throw new BadRequestException('File harus berupa gambar');

    const photoUrl = file ? await this.storePhoto(user.id, file) : null;

    const content: Exclude<ChatMessage['content'], string> = [];
    if (input.text) content.push({ type: 'text', text: `Catatan user: ${input.text}` });
    if (file) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
      });
    }

    let analysis: FoodAnalysis | null = null;
    let model: string | null = null;
    let raw: unknown = null;
    try {
      const result = await this.ai.chatJson({
        feature: file ? 'food_photo' : 'food_text',
        model: file ? this.ai.visionModel : this.ai.textModel,
        userId: user.id,
        schema: foodAnalysisSchema,
        messages: [
          { role: 'system', content: FOOD_SYSTEM_PROMPT },
          { role: 'user', content: file ? content : (input.text as string) },
        ],
      });
      ({ data: analysis, model, raw } = result);
    } catch (err) {
      if (!(err instanceof AiFailedError)) throw err;
      this.logger.warn(`Food analysis failed, falling back to manual: ${err.message}`);
    }

    const items =
      analysis?.items.map((i) => ({
        name: i.name,
        portionDesc: i.portion_desc ?? null,
        grams: round1(i.grams),
        calories: Math.round(i.calories),
        proteinG: round1(i.protein_g),
        carbsG: round1(i.carbs_g),
        fatG: round1(i.fat_g),
        confidence: i.confidence ?? null,
      })) ?? [];

    return this.prisma.meal.create({
      data: {
        userId: user.id,
        mealType: input.mealType,
        eatenAt: input.eatenAt ? new Date(input.eatenAt) : new Date(),
        photoUrl,
        rawText: input.text ?? null,
        status: analysis ? 'draft' : 'needs_manual',
        assumptions: analysis?.assumptions ?? [],
        aiModel: model,
        aiRawJson: raw ?? undefined,
        ...totals(items),
        items: { create: items },
      },
      include: { items: true },
    });
  }

  async update(userId: string, id: string, body: UpdateInput) {
    const meal = await this.own(userId, id);
    const before = new Map(meal.items.map((i) => [i.id, i]));
    const items = body.items.map((i) => {
      const prev = i.id ? before.get(i.id) : undefined;
      const edited =
        !prev ||
        prev.editedByUser ||
        prev.name !== i.name ||
        prev.grams !== i.grams ||
        prev.calories !== i.calories ||
        prev.proteinG !== i.proteinG ||
        prev.carbsG !== i.carbsG ||
        prev.fatG !== i.fatG;
      return {
        name: i.name,
        portionDesc: i.portionDesc ?? null,
        grams: i.grams,
        calories: i.calories,
        proteinG: i.proteinG,
        carbsG: i.carbsG,
        fatG: i.fatG,
        confidence: prev?.confidence ?? null,
        editedByUser: edited,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.mealItem.deleteMany({ where: { mealId: id } });
      return tx.meal.update({
        where: { id },
        data: {
          ...(body.mealType ? { mealType: body.mealType } : {}),
          ...(body.eatenAt ? { eatenAt: new Date(body.eatenAt) } : {}),
          ...(meal.status === 'needs_manual' && items.length ? { status: 'draft' as const } : {}),
          ...totals(items),
          items: { create: items },
        },
        include: { items: true },
      });
    });
  }

  async confirm(userId: string, id: string) {
    const meal = await this.own(userId, id);
    if (!meal.items.length)
      throw new BadRequestException('Tambahkan minimal 1 item makanan sebelum disimpan');
    return this.prisma.meal.update({
      where: { id },
      data: { status: 'confirmed' },
      include: { items: true },
    });
  }

  /**
   * Meals worth one-tap re-logging: favorites first, then the most eaten in the last 30 days.
   * Repeats of the same foods collapse into the most recent one.
   */
  async recent(userId: string) {
    const since = new Date(Date.now() - 30 * 86400000);
    const meals = await this.prisma.meal.findMany({
      where: { userId, status: 'confirmed', OR: [{ eatenAt: { gte: since } }, { favorite: true }] },
      include: { items: true },
      orderBy: { eatenAt: 'desc' },
      omit: { aiRawJson: true },
      take: 300,
    });
    const groups = new Map<string, { meal: (typeof meals)[number]; count: number; favorite: boolean }>();
    for (const meal of meals) {
      if (!meal.items.length) continue;
      const key = signature(meal.items);
      const g = groups.get(key);
      if (g) {
        g.count++;
        g.favorite ||= meal.favorite;
      } else groups.set(key, { meal, count: 1, favorite: meal.favorite });
    }
    return [...groups.values()]
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.count - a.count)
      .slice(0, 15)
      .map(({ meal, count, favorite }) => ({ ...meal, favorite, timesEaten: count }));
  }

  /** Logs the same foods again as a confirmed meal; the photo is shared, not copied. */
  async repeat(userId: string, id: string, input: z.infer<typeof repeatSchema>) {
    const src = await this.own(userId, id);
    if (!src.items.length) throw new BadRequestException('Makanan ini belum punya item');
    const items = src.items.map(
      ({ name, portionDesc, grams, calories, proteinG, carbsG, fatG, confidence }) => ({
        name,
        portionDesc,
        grams,
        calories,
        proteinG,
        carbsG,
        fatG,
        confidence,
      }),
    );
    return this.prisma.meal.create({
      data: {
        userId,
        mealType: input.mealType,
        eatenAt: input.eatenAt ? new Date(input.eatenAt) : new Date(),
        photoUrl: src.photoUrl,
        rawText: src.rawText,
        status: 'confirmed',
        assumptions: src.assumptions ?? [],
        aiModel: src.aiModel,
        ...totals(items),
        items: { create: items },
      },
      include: { items: true },
    });
  }

  /** Favoriting marks every logged copy of the same foods, so it sticks whichever copy is shown. */
  async setFavorite(userId: string, id: string, favorite: boolean) {
    const meal = await this.own(userId, id);
    const key = signature(meal.items);
    const candidates = await this.prisma.meal.findMany({
      where: { userId, favorite: !favorite, status: 'confirmed' },
      select: { id: true, items: { select: { name: true } } },
    });
    const ids = [id, ...candidates.filter((m) => signature(m.items) === key).map((m) => m.id)];
    await this.prisma.meal.updateMany({ where: { userId, id: { in: ids } }, data: { favorite } });
    return { favorite };
  }

  async own(userId: string, id: string) {
    const meal = await this.prisma.meal.findFirst({ where: { id, userId }, include: { items: true } });
    if (!meal) throw new NotFoundException('Data makanan tidak ditemukan');
    return meal;
  }

  async photo(
    userId: string,
    id: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }> {
    const meal = await this.own(userId, id);
    if (!meal.photoUrl) throw new NotFoundException('Tidak ada foto');
    const blob = await getBlob(meal.photoUrl, { access: 'private', token: this.blobToken() });
    if (!blob || blob.statusCode !== 200) throw new NotFoundException('Foto tidak ditemukan');
    return { stream: blob.stream, contentType: blob.blob.contentType };
  }

  private blobToken() {
    return this.config.get<string>('BLOB_READ_WRITE_TOKEN');
  }

  private async storePhoto(userId: string, file: Express.Multer.File): Promise<string | null> {
    if (!this.blobToken()) return null;
    try {
      const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      const blob = await putBlob(`meals/${userId}/${Date.now()}.${ext}`, file.buffer, {
        access: 'private',
        contentType: file.mimetype,
        addRandomSuffix: true,
        token: this.blobToken(),
      });
      return blob.url;
    } catch (err) {
      this.logger.error(`Photo upload failed: ${(err as Error).message}`);
      return null;
    }
  }
}

@Controller('meals')
@UseGuards(JwtAuthGuard)
export class MealController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meals: MealService,
  ) {}

  @Post('analyze')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  analyze(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(analyzeSchema)) body: z.infer<typeof analyzeSchema>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.meals.analyze(user, body, file);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = date ?? localDate(user.timezone);
    if (!isDateString(day)) throw new BadRequestException('Format tanggal YYYY-MM-DD');
    const { start, end } = dayRange(day, user.timezone);
    return this.prisma.meal.findMany({
      where: { userId: user.id, eatenAt: { gte: start, lt: end } },
      include: { items: true },
      orderBy: { eatenAt: 'asc' },
      omit: { aiRawJson: true },
    });
  }

  @Get('recent')
  recent(@CurrentUser() user: AuthUser) {
    return this.meals.recent(user.id);
  }

  @Post(':id/repeat')
  repeat(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(repeatSchema)) body: z.infer<typeof repeatSchema>,
  ) {
    return this.meals.repeat(user.id, id, body);
  }

  @Put(':id/favorite')
  favorite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(favoriteSchema)) body: z.infer<typeof favoriteSchema>,
  ) {
    return this.meals.setFavorite(user.id, id, body.favorite);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.meals.own(user.id, id);
    return this.prisma.meal.findUnique({
      where: { id },
      include: { items: true },
      omit: { aiRawJson: true },
    });
  }

  @Get(':id/photo')
  async photo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const blob = await this.meals.photo(user.id, id);
    res.setHeader('Content-Type', blob.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(Readable.fromWeb(blob.stream as unknown as WebReadableStream));
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateSchema)) body: UpdateInput,
  ) {
    return this.meals.update(user.id, id, body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meals.confirm(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.meals.own(user.id, id);
    await this.prisma.meal.delete({ where: { id } });
  }
}

@Module({ controllers: [MealController], providers: [MealService] })
export class MealModule {}
