import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Logger,
  Module,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dateOnly, dayRange, localDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../reminder/mail.service';
import { SummaryModule, SummaryService } from '../summary/summary.module';

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` as a GET request. */
@Injectable()
export class CronGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = Buffer.from(`Bearer ${this.config.getOrThrow<string>('CRON_SECRET')}`);
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

  /** F7: 21:00 WIB, generate summaries for users who logged today. */
  @Get('daily-summary')
  async dailySummary() {
    const users = await this.prisma.user.findMany({
      where: { profile: { isNot: null } },
      select: { id: true, timezone: true },
    });
    let generated = 0;
    let failed = 0;
    for (const user of users) {
      const date = localDate(user.timezone);
      const exists = await this.prisma.dailySummary.findUnique({
        where: { userId_date: { userId: user.id, date: dateOnly(date) } },
      });
      if (exists || !(await this.hasLogToday(user.id, user.timezone, date))) continue;
      try {
        await this.summaries.generate(user, date);
        generated++;
      } catch (err) {
        failed++;
        this.logger.error(`Summary for ${user.id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: users.length, generated, failed };
  }
}

@Module({
  imports: [SummaryModule],
  controllers: [CronController],
  providers: [CronGuard, MailService],
})
export class CronModule {}
