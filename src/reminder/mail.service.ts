import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  private transport(): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get('SMTP_PORT', 587));
      this.transporter = nodemailer.createTransport({
        host: this.config.getOrThrow<string>('SMTP_HOST'),
        port,
        secure: this.config.get('SMTP_SECURE', port === 465 ? 'true' : 'false') === 'true',
        auth: {
          user: this.config.getOrThrow<string>('SMTP_USER'),
          pass: this.config.getOrThrow<string>('SMTP_PASS'),
        },
      });
    }
    return this.transporter;
  }

  async sendReminder(to: { email: string; name: string }) {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const firstName = to.name.split(' ')[0];
    const text = [
      `Hai ${firstName},`,
      '',
      'Hari ini belum ada catatan makan, olahraga, atau berat badan.',
      'Catat sekarang supaya summary jam 21:00 bisa dibuat:',
      appUrl,
      '',
      'Reminder ini bisa dimatikan di menu Pengaturan.',
    ].join('\n');

    await this.transport().sendMail({
      from: this.config.getOrThrow<string>('MAIL_FROM'),
      to: to.email,
      subject: 'Belum ada log hari ini',
      text,
    });
    this.logger.log(`Reminder sent to ${to.email}`);
  }
}
