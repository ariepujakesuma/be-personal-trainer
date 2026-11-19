import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { extractJson } from './json';
import { parseChatBody } from './response';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export class AiFailedError extends Error {}

/**
 * Single gateway to 9Router (OpenAI-compatible). Feature modules never call
 * the router directly, so changing combos or providers stays in one place.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  get visionModel() {
    return this.config.get<string>('AI_MODEL_VISION', 'pt-vision');
  }

  get textModel() {
    return this.config.get<string>('AI_MODEL_TEXT', 'pt-text');
  }

  /**
   * Calls the model, validates the JSON with `schema`, and retries once with
   * the validation error when the output is not usable.
   */
  async chatJson<T extends z.ZodType>(opts: {
    feature: string;
    model: string;
    messages: ChatMessage[];
    schema: T;
    userId?: string;
  }): Promise<{ data: z.infer<T>; model: string; raw: unknown }> {
    const messages = [...opts.messages];
    let lastError = 'unknown';

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.call(opts.feature, opts.model, messages, opts.userId);
      const content = res.choices?.[0]?.message?.content ?? '';
      try {
        const raw = extractJson(content);
        const parsed = opts.schema.safeParse(raw);
        if (parsed.success) return { data: parsed.data, model: res.model ?? opts.model, raw };
        lastError = z.prettifyError(parsed.error);
      } catch (err) {
        lastError = (err as Error).message;
      }
      this.logger.warn(`${opts.feature}: invalid JSON (attempt ${attempt + 1}): ${lastError}`);
      messages.push(
        { role: 'assistant', content },
        {
          role: 'user',
          content: `JSON tidak valid: ${lastError}. Kirim ulang hanya objek JSON yang valid sesuai format.`,
        },
      );
    }
    throw new AiFailedError(`AI output invalid: ${lastError}`);
  }

  private async call(feature: string, model: string, messages: ChatMessage[], userId?: string) {
    const baseUrl = this.config.getOrThrow<string>('NINEROUTER_BASE_URL').replace(/\/$/, '');
    const apiKey = this.config.getOrThrow<string>('NINEROUTER_API_KEY');
    const jsonMode = this.config.get<string>('AI_JSON_MODE', 'true') === 'true';
    const started = Date.now();

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: false,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(Number(this.config.get('AI_TIMEOUT_MS', 50000))),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new AiFailedError(`9Router HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
      const json = parseChatBody(await response.text());
      await this.logUsage({
        userId,
        feature,
        model: json.model ?? model,
        tokensIn: json.usage?.prompt_tokens,
        tokensOut: json.usage?.completion_tokens,
        latencyMs: Date.now() - started,
        status: 'ok',
      });
      return json;
    } catch (err) {
      const message = (err as Error).message;
      await this.logUsage({
        userId,
        feature,
        model,
        latencyMs: Date.now() - started,
        status: 'error',
        error: message,
      });
      throw err instanceof AiFailedError ? err : new AiFailedError(message);
    }
  }

  private async logUsage(entry: {
    userId?: string;
    feature: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    status: string;
    error?: string;
  }) {
    try {
      await this.prisma.aiUsageLog.create({ data: entry });
    } catch (err) {
      this.logger.error(`Failed to log AI usage: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [AiService], exports: [AiService] })
export class AiModule {}
