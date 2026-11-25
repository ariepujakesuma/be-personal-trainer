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

  /** The day's AI summary as an HTML email (plain-text part for clients without HTML). */
  async sendDailySummary(to: { email: string; name: string }, summary: SummaryEmail) {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const { html, text, subject } = renderSummaryEmail({ ...summary, name: to.name.split(' ')[0], appUrl });
    await this.transport().sendMail({
      from: this.config.getOrThrow<string>('MAIL_FROM'),
      to: to.email,
      subject,
      text,
      html,
    });
    this.logger.log(`Summary email sent to ${to.email}`);
  }
}

export interface SummaryEmail {
  date: string;
  score: number;
  summary: string;
  highlights: string[];
  warnings: string[];
  recommendations: { type: string; text: string }[];
  intakeKcal: number;
  targetKcal: number;
  burnKcal: number;
  proteinG: number;
  targetProteinG: number;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => Math.round(n).toLocaleString('id-ID');
const REC_LABEL: Record<string, string> = { nutrition: 'Makan', workout: 'Latihan', habit: 'Kebiasaan' };

/**
 * Table layout with inline styles: what email clients (Gmail, Outlook, iOS Mail) render
 * reliably. Colours follow the app: orange accent on a light grey page, white card.
 */
export function renderSummaryEmail(s: SummaryEmail & { name: string; appUrl: string }) {
  const dateLabel = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${s.date}T00:00:00Z`));
  const scoreColor = s.score >= 75 ? '#0F9E8A' : s.score >= 50 ? '#C96A12' : '#B42318';
  const list = (items: string[], color: string) =>
    items
      .map(
        (t) =>
          `<tr><td style="padding:4px 0;vertical-align:top;width:16px;padding-right:8px;color:${color};font-size:16px;line-height:22px">&#9679;</td><td style="padding:4px 0;font-size:15px;line-height:22px;color:#15161A">${esc(t)}</td></tr>`,
      )
      .join('');
  const section = (title: string, body: string) =>
    body
      ? `<tr><td style="padding:20px 24px 0"><p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.02em;color:#5C5F66;text-transform:uppercase">${title}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>`
      : '';
  const stat = (label: string, value: string, sub: string) =>
    `<td width="33%" style="padding:12px 8px;text-align:center;background:#F3F3F1;border-radius:12px"><p style="margin:0;font-size:12px;color:#5C5F66">${label}</p><p style="margin:2px 0 0;font-size:22px;font-weight:700;color:#15161A">${value}</p><p style="margin:0;font-size:12px;color:#5C5F66">${sub}</p></td>`;
  const recs = s.recommendations
    .map(
      (r) =>
        `<tr><td style="padding:6px 8px 6px 0;vertical-align:top;width:96px"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#FDEBE2;color:#B83A00;font-size:12px;font-weight:600">${REC_LABEL[r.type] ?? 'Tips'}</span></td><td style="padding:6px 0;font-size:15px;line-height:22px;color:#15161A">${esc(r.text)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Summary ${esc(dateLabel)}</title></head>
<body style="margin:0;padding:0;background:#F3F3F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">Skor ${s.score}/100 · ${num(s.intakeKcal)} dari ${num(s.targetKcal)} kkal</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F3F1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden">
<tr><td style="padding:24px 24px 0"><p style="margin:0;font-size:14px;font-weight:600;color:#B83A00">Summary harian · ${esc(dateLabel)}</p><h1 style="margin:6px 0 0;font-size:24px;line-height:30px;color:#15161A">Hai ${esc(s.name)}, ini catatan harimu</h1></td></tr>
<tr><td style="padding:20px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:72px;height:72px;border-radius:36px;background:${scoreColor};text-align:center;vertical-align:middle;color:#FFFFFF;font-size:26px;font-weight:700">${s.score}</td>
<td style="padding-left:14px;font-size:15px;line-height:22px;color:#15161A">${esc(s.summary)}</td></tr></table></td></tr>
<tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${stat('Kalori', num(s.intakeKcal), `dari ${num(s.targetKcal)} kkal`)}${stat('Protein', `${num(s.proteinG)} g`, `dari ${num(s.targetProteinG)} g`)}${stat('Olahraga', num(s.burnKcal), 'kkal terbakar')}
</tr></table></td></tr>
${section('Yang sudah bagus', list(s.highlights, '#0F9E8A'))}
${section('Perlu diperhatikan', list(s.warnings, '#C96A12'))}
${section('Rekomendasi untuk besok', recs)}
<tr><td style="padding:24px" align="center"><a href="${esc(s.appUrl)}/summary?date=${s.date}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#F05312;color:#FFFFFF;font-size:16px;font-weight:600;text-decoration:none">Buka di aplikasi</a></td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#5C5F66">Email ini dikirim karena email harian aktif. Matikan di Profil → Pengaturan.</p>
</td></tr></table></body></html>`;

  const text = [
    `Hai ${s.name},`,
    '',
    `Summary ${dateLabel}: skor ${s.score}/100`,
    s.summary,
    '',
    `Kalori ${num(s.intakeKcal)} / ${num(s.targetKcal)} kkal · Protein ${num(s.proteinG)} / ${num(s.targetProteinG)} g · Olahraga ${num(s.burnKcal)} kkal`,
    ...(s.highlights.length ? ['', 'Yang sudah bagus:', ...s.highlights.map((h) => `- ${h}`)] : []),
    ...(s.warnings.length ? ['', 'Perlu diperhatikan:', ...s.warnings.map((w) => `- ${w}`)] : []),
    '',
    'Rekomendasi untuk besok:',
    ...s.recommendations.map((r) => `- ${r.text}`),
    '',
    `${s.appUrl}/summary?date=${s.date}`,
  ].join('\n');

  return { html, text, subject: `Summary ${dateLabel}: skor ${s.score}/100` };
}
