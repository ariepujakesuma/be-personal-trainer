import { z } from 'zod';

const num = z.coerce.number().finite().nonnegative();

export const foodAnalysisSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        portion_desc: z.string().optional().nullable(),
        grams: num,
        calories: num,
        protein_g: num,
        carbs_g: num,
        fat_g: num,
        confidence: z.coerce.number().min(0).max(1).optional().nullable(),
      }),
    )
    .min(1),
  assumptions: z.array(z.string()).optional().default([]),
});
export type FoodAnalysis = z.infer<typeof foodAnalysisSchema>;

export const exerciseParseSchema = z.object({
  name: z.string().min(1),
  matched_type: z.string().nullable().optional(),
  duration_min: z.coerce.number().int().positive(),
  intensity: z.enum(['light', 'moderate', 'vigorous']).catch('moderate'),
  distance_km: z.coerce.number().positive().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type ExerciseParse = z.infer<typeof exerciseParseSchema>;

export const dailySummarySchema = z.object({
  score: z.coerce.number().int().min(0).max(100),
  summary: z.string().min(1),
  highlights: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  recommendations: z
    .array(
      z.object({
        type: z.enum(['nutrition', 'workout', 'habit']).catch('habit'),
        text: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
});
export type DailySummaryAi = z.infer<typeof dailySummarySchema>;
