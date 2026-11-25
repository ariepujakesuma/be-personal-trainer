import {
  CanActivate,
  Controller,
  ExecutionContext,
  BadRequestException,
  Get,
  Injectable,
  Logger,
  Module,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dateOnly, dayRange, isDateString, localDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../reminder/mail.service';
import type { DailySummaryAi } from '../ai/schemas';
import { DashboardModule, DashboardService } from '../dashboard/dashboard.module';
import { SummaryModule, SummaryService } from '../summary/summary.module';

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` as a GET request. */
@Injectable()
export class CronGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret) {
      // Without it Vercel sends no Authorization header and every scheduled run is refused.
      new Logger(CronGuard.name).error('CRON_SECRET is not set: scheduled jobs cannot run');
      throw new UnauthorizedException();
    }
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException();
    return true;
  }
}

@Controller('internal/cron')
@UseGuards(CronGuard)
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly summaries: SummaryService,
    private readonly dashboard: DashboardService,
  ) {}

  private async hasLogToday(userId: string, timeZone: string, date: string) {
    const { start, end } = dayRange(date, timeZone);
    const [meal, exercise, weight] = await Promise.all([
      this.prisma.meal.count({ where: { userId, eatenAt: { gte: start, lt: end } } }),
      this.prisma.exerciseLog.count({ where: { userId, performedAt: { gte: start, lt: end } } }),
      this.prisma.weightLog.count({ where: { userId, date: dateOnly(date) } }),
    ]);
    return meal + exercise + weight > 0;
  }

  /** F11: 20:00 WIB, email users with no log today. Max 1 per user per day. */
  @Get('reminder')
  async reminder() {
    const users = await this.prisma.user.findMany({
      where: { profile: { emailReminderEnabled: true } },
      select: { id: true, email: true, name: true, timezone: true },
    });
    let sent = 0;
    let failed = 0;
    for (const user of users) {
      const date = localDate(user.timezone);
      if (await this.hasLogToday(user.id, user.timezone, date)) continue;
      const already = await this.prisma.notificationLog.findUnique({
        where: { userId_type_date: { userId: user.id, type: 'no_log_reminder', date: dateOnly(date) } },
      });
      if (already) continue;
      let status = 'sent';
      try {
        await this.mail.sendReminder(user);
        sent++;
      } catch (err) {
        status = 'failed';
        failed++;
        this.logger.error(`Reminder to ${user.email} failed: ${(err as Error).message}`);
      }
      await this.prisma.notificationLog.create({
        data: { userId: user.id, type: 'no_log_reminder', date: dateOnly(date), status },
      });
    }
    return { checked: users.length, sent, failed };
  }

  /**
   * F7: 21:00 WIB (on the Hobby plan Vercel runs it any time in that hour). Generates the
   * summary for users who logged today and emails it to those with daily email on.
   * Users run a few at a time, so one slow AI call cannot push the run past its time limit.
   */
  @Get('daily-summary')
  async dailySummary(@Query('date') onlyDate?: string) {
    // ?date=YYYY-MM-DD reruns a past day by hand (testing, or a missed run) without touching today.
    if (onlyDate !== undefined && !isDateString(onlyDate))
      throw new BadRequestException('Format tanggal YYYY-MM-DD');
    const users = await this.prisma.user.findMany({
      where: { profile: { isNot: null } },
      select: { id: true, email: true, name: true, timezone: true, profile: true },
    });
    const result = { checked: users.length, generated: 0, emailed: 0, failed: 0 };

    await inBatches(users, 4, async (user) => {
      const profile = user.profile!;
      const date = onlyDate ?? localDate(user.timezone);
      try {
        let summary = await this.prisma.dailySummary.findUnique({
          where: { userId_date: { userId: user.id, date: dateOnly(date) } },
        });
        if (!summary) {
          if (!(await this.hasLogToday(user.id, user.timezone, date))) return;
          summary = await this.summaries.generate(user, date);
          result.generated++;
        }
        if (!profile.emailReminderEnabled) return;
        const already = await this.prisma.notificationLog.findUnique({
          where: { userId_type_date: { userId: user.id, type: 'daily_summary_email', date: dateOnly(date) } },
        });
        if (already) return;
        const ai = summary.aiJson as unknown as DailySummaryAi;
        const day = await this.dashboard.day(user.id, user.timezone, date);
        let status = 'sent';
        try {
          await this.mail.sendDailySummary(user, {
            date,
            ...ai,
            intakeKcal: day.intake.calories,
            targetKcal: day.targets.calories + day.burn,
            burnKcal: day.burn,
            proteinG: day.intake.proteinG,
            targetProteinG: day.targets.proteinG,
          });
          result.emailed++;
        } catch (err) {
          status = 'failed';
          this.logger.error(`Summary email to ${user.email} failed: ${(err as Error).message}`);
        }
        await this.prisma.notificationLog.create({
          data: { userId: user.id, type: 'daily_summary_email', date: dateOnly(date), status },
        });
      } catch (err) {
        result.failed++;
        this.logger.error(`Summary for ${user.id} failed: ${(err as Error).message}`);
      }
    });
    this.logger.log(`daily-summary ${JSON.stringify(result)}`);
    return result;
  }
}

/** Runs `fn` over `items`, `size` at a time. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

@Module({
  imports: [SummaryModule, DashboardModule],
  controllers: [CronController],
  providers: [CronGuard, MailService],
})
export class CronModule {}
