import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/bootstrap';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handler: Promise<Handler> | undefined;

/** Vercel serverless entry: reuse one Nest app per warm instance. */
export default async function vercel(req: IncomingMessage, res: ServerResponse) {
  handler ??= createApp().then(async (app) => {
    await app.init();
    return app.getHttpAdapter().getInstance() as Handler;
  });
  (await handler)(req, res);
}
