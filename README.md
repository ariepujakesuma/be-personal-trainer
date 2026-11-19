# be-personal-trainer

Backend AI Personal Trainer: log olahraga, log makanan dari foto (estimasi kalori lewat 9Router), summary dan rekomendasi harian, reminder email.

Stack: NestJS 11, Prisma 6 (MySQL / TiDB Cloud), Vercel Blob, SMTP, Vercel Cron.

## Setup lokal

```bash
cp .env.example .env      # isi DATABASE_URL, JWT_SECRET, NINEROUTER_*, SMTP_*
npm install               # menjalankan prisma generate
npx prisma db push        # buat / update tabel (jalankan lagi setiap schema berubah)
npm run db:seed           # 25 jenis olahraga + nilai MET
npm run start:dev         # http://localhost:3000/api/v1
```

Untuk TiDB Cloud, `DATABASE_URL` harus diakhiri `?sslaccept=strict`.

## Endpoint

Semua di bawah `/api/v1`. Semua butuh `Authorization: Bearer <jwt>`, kecuali auth, health, dan cron.

| Method | Path | Fitur |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login` | F1 |
| GET | `/auth/me` | F1 |
| GET / PUT | `/profile` | F1, F11 (setting reminder) |
| GET | `/exercise-types` | F2 |
| POST | `/exercises/parse` | F2, teks bebas ke draft (AI, tidak disimpan) |
| POST / GET | `/exercises`, `/exercises?date=` | F2 |
| PUT / DELETE | `/exercises/:id` | F2 |
| POST | `/meals/analyze` | F3/F4, multipart `photo` + `mealType` + `text` opsional, hasilnya meal `draft` |
| GET | `/meals?date=`, `/meals/:id`, `/meals/:id/photo` | F3/F4 |
| PUT | `/meals/:id` | Edit item (item yang diubah ditandai `editedByUser`) |
| POST | `/meals/:id/confirm` | Masuk ke total harian |
| DELETE | `/meals/:id` | |
| POST / GET | `/weights` | F5, berat + 11 data komposisi tubuh opsional (field kosong/`null` menghapus nilainya) |
| GET | `/dashboard/daily?date=` | F6 |
| GET | `/summaries/daily?date=` | F7 |
| POST | `/summaries/daily/generate?date=` | F7 |
| GET | `/internal/cron/reminder` | F11, cron 20:00 WIB |
| GET | `/internal/cron/daily-summary` | F7, cron 21:00 WIB |

Endpoint cron memakai GET karena Vercel Cron mengirim GET dengan header `Authorization: Bearer $CRON_SECRET`. Jadwalnya di `vercel.json` dalam UTC (13:00 dan 14:00 UTC = 20:00 dan 21:00 WIB).

## AI (9Router)

Semua panggilan AI lewat `src/ai/ai.service.ts`:

- `AI_MODEL_VISION` (default `pt-vision`): analisis foto. Combo ini hanya boleh berisi model yang bisa menerima gambar (Gemini).
- `AI_MODEL_TEXT` (default `pt-text`): parse teks, summary.
- Output divalidasi dengan zod. Kalau tidak valid, ada retry 1x dengan pesan error. Kalau tetap gagal, meal disimpan sebagai `needs_manual` supaya user bisa isi sendiri.
- Setiap panggilan dicatat di `ai_usage_logs`.
- Set `AI_JSON_MODE=false` kalau combo menolak `response_format`.

Kalori olahraga dihitung di backend (MET × kg × jam × faktor intensitas), tidak oleh AI. Target harian memakai rumus Mifflin-St Jeor; untuk goal `recomp` defaultnya TDEE −400 kkal, protein 1,8 g/kg, dan lemak 25% kalori.

## Deploy (Vercel)

Vercel mendeteksi NestJS dari `src/main.ts` (zero-config; file itu harus meng-import `@nestjs/core` langsung) dan menjalankannya sebagai satu Vercel Function. Framework Preset di Project Settings harus **NestJS** dan Output Directory dibiarkan kosong. `vercel.json` hanya berisi jadwal cron. Isi semua env dari `.env.example` di project Vercel.

## Test

```bash
npm test
```
