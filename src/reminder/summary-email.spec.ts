/* eslint-disable @typescript-eslint/no-unsafe-assignment -- test fixture */
import { writeFileSync } from 'node:fs';
import { renderSummaryEmail } from './mail.service';

describe('summary email', () => {
  const email = renderSummaryEmail({
    name: 'Arie',
    appUrl: 'https://pt.example.com',
    date: '2026-11-24',
    score: 72,
    summary: 'Asupan kalori pas dengan target, tapi protein masih kurang <30 g> dari target.',
    highlights: ['Kalori 1.740 kkal, dekat dengan target 1.762 kkal', 'Latihan Full body A selesai'],
    warnings: ['Protein baru 128 g dari 159 g'],
    recommendations: [
      { type: 'nutrition', text: 'Tambah telur atau dada ayam di sarapan besok.' },
      { type: 'workout', text: 'Besok jadwal lari santai 25 menit.' },
      { type: 'habit', text: 'Timbang pagi sebelum sarapan.' },
    ],
    intakeKcal: 1740,
    targetKcal: 1762,
    burnKcal: 264,
    proteinG: 128,
    targetProteinG: 159,
  });

  it('escapes AI text and links to the day', () => {
    expect(email.html).toContain('&lt;30 g&gt;');
    expect(email.html).toContain('https://pt.example.com/summary?date=2026-11-24');
    expect(email.subject).toBe('Summary Selasa, 24 November: skor 72/100');
    expect(email.text).toContain('Rekomendasi untuk besok:');
    writeFileSync('/tmp/summary-email.html', email.html);
  });
});
