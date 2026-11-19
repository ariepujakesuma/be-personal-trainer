import { parseChatBody } from './response';

describe('parseChatBody', () => {
  it('parses a normal completion', () => {
    const r = parseChatBody(JSON.stringify({ model: 'm', choices: [{ message: { content: '{"a":1}' } }] }));
    expect(r.choices?.[0].message?.content).toBe('{"a":1}');
  });

  it('merges SSE chunks', () => {
    const body = [
      'data: {"model":"groq/x","choices":[{"delta":{"content":"{\\"a\\""}}]}',
      '',
      'data: {"choices":[{"delta":{"content":":1}"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}',
      'data: [DONE]',
    ].join('\n');
    const r = parseChatBody(body);
    expect(r.model).toBe('groq/x');
    expect(r.choices?.[0].message?.content).toBe('{"a":1}');
    expect(r.usage?.completion_tokens).toBe(3);
  });

  it('merges NDJSON chunks (the failure seen in production)', () => {
    const body = [
      JSON.stringify({ model: 'm', choices: [{ delta: { content: '{"items":' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '[]}' } }] }),
    ].join('\n');
    expect(parseChatBody(body).choices?.[0].message?.content).toBe('{"items":[]}');
  });

  it('merges Ollama native NDJSON', () => {
    const body = [
      '{"model":"gpt-oss","message":{"content":"{\\"a\\":"}}',
      '{"message":{"content":"2}"},"done":true}',
    ].join('\n');
    expect(parseChatBody(body).choices?.[0].message?.content).toBe('{"a":2}');
  });

  it('throws on unreadable bodies', () => {
    expect(() => parseChatBody('<html>Bad gateway</html>')).toThrow('tidak bisa dibaca');
  });
});
