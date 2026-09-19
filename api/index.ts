import type { IncomingMessage, ServerResponse } from 'node:http';
import { initializeApp } from '../server/runtime.js';

let application: ReturnType<typeof initializeApp> | undefined;
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  application ??= initializeApp().catch((error) => {
    application = undefined;
    throw error;
  });
  const app = await application;
  app(req, res);
}
