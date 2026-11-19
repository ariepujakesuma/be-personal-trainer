export interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface Chunk {
  model?: string;
  choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  message?: { content?: string }; // Ollama native NDJSON
}

/**
 * Parses a chat completion body. Usually one JSON object, but some routed providers
 * answer as a stream even when not asked: SSE (`data: {...}` lines) or NDJSON
 * (one object per line). Stream chunks are merged into a single response.
 */
export function parseChatBody(body: string): ChatResponse {
  const text = body.trim();
  try {
    return JSON.parse(text) as ChatResponse;
  } catch {
    // fall through to stream parsing
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^data:\s*/, ''))
    .filter((l) => l && l !== '[DONE]' && !l.startsWith('event:') && !l.startsWith(':'));

  const merged: ChatResponse = {};
  let content = '';
  let parsedAny = false;
  for (const line of lines) {
    let chunk: Chunk;
    try {
      chunk = JSON.parse(line) as Chunk;
    } catch {
      continue;
    }
    parsedAny = true;
    merged.model ??= chunk.model;
    if (chunk.usage) merged.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    content += choice?.delta?.content ?? choice?.message?.content ?? chunk.message?.content ?? '';
  }
  if (!parsedAny) throw new Error(`Respons 9Router tidak bisa dibaca: ${text.slice(0, 200)}`);
  merged.choices = [{ message: { content } }];
  return merged;
}
