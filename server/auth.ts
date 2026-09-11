import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Express, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, Store } from './store.js';
import type { User } from '../shared/schema.js';
import { createSmtpMailer, readSmtpConfig, type SmtpConfig } from './mail.js';

declare global {
  namespace Express {
    interface Request {
      user: User;
      keyName?: string;
    }
  }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derivePassword = promisify(scrypt);
export type AuthConfig = {
  origin: string;
  production: boolean;
  emailAuth?: boolean;
  mailMode: 'smtp' | 'console';
  smtp?: SmtpConfig;
  sendCode?: (email: string, code: string) => Promise<void>;
};

export function setupAuth(app: Express, store: Store, config: AuthConfig) {
  const db = store.db;
  const emailAuth = config.emailAuth !== false;
  db.exec('CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO secrets VALUES (?,?)').run(
    'code_hmac',
    randomBytes(32).toString('hex'),
  );
  const secret = (
    db.prepare('SELECT value FROM secrets WHERE name=?').get('code_hmac') as { value: string }
  ).value;
  const codeHash = (email: string, code: string) =>
    createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
  const secure = config.origin.startsWith('https:');
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  if (emailAuth && config.production && config.mailMode === 'console')
    throw new Error('Console login codes are development-only. Configure SMTP for production.');
  const sendCode = emailAuth
    ? (config.sendCode ??
      (config.mailMode === 'smtp'
        ? createSmtpMailer(config.smtp ?? readSmtpConfig()).sendCode
        : async (email: string, code: string) => {
            console.info(`[development email] To: ${email} | Sign-in code: ${code}`);
          }))
    : undefined;
  const emailSchema = z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase());
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });
  const passwordSchema = z.string().min(12).max(128);
  const createPasswordHash = async (password: string) => {
    const salt = randomBytes(16);
    const derived = (await derivePassword(password, salt, 64)) as Buffer;
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  };
  const passwordMatches = async (password: string, stored: string) => {
    const [algorithm, saltText, hashText] = stored.split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const derived = (await derivePassword(
      password,
      Buffer.from(saltText, 'base64url'),
      64,
    )) as Buffer;
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  };
  const issueSession = (user: User, res: Response) => {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      hash(token),
      user.id,
      Date.now() + 30 * 86400_000,
    );
    store.audit(user.id, 'account.login', {});
    res.cookie('brownbag_session', token, { ...cookie, maxAge: 30 * 86400_000 }).json(user);
  };
  app.get('/api/auth/config', (_req, res) =>
    res.json({ emailAuth, mailMode: emailAuth ? config.mailMode : undefined }),
  );
  app.post('/api/auth/code', limit, async (req, res) => {
    if (!emailAuth) throw new AppError(404, 'Email sign-in is disabled.');
    const email = emailSchema.parse(req.body.email);
    const old = db.prepare('SELECT sent_at FROM login_codes WHERE email=?').get(email) as
      { sent_at: number } | undefined;
    if (old && Date.now() - old.sent_at < 60_000)
      throw new AppError(429, 'Please wait a minute before requesting another code.');
    const code = String(randomInt(10000000, 100000000));
    db.prepare(
      'INSERT INTO login_codes VALUES (?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at',
    ).run(email, codeHash(email, code), Date.now() + 600_000, Date.now());
    try {
      await sendCode!(email, code);
    } catch (error) {
      db.prepare('DELETE FROM login_codes WHERE email=? AND hash=?').run(
        email,
        codeHash(email, code),
      );
      console.error('Email delivery failed:', error instanceof Error ? error.message : 'unknown');
      throw new AppError(
        503,
        'Could not send the email. Check your mail configuration and try again.',
      );
    }
    res.json({ ok: true });
  });
  app.post('/api/auth/verify', limit, (req, res) => {
    if (!emailAuth) throw new AppError(404, 'Email sign-in is disabled.');
    const email = emailSchema.parse(req.body.email);
    const code = z
      .string()
      .regex(/^\d{8}$/)
      .parse(req.body.code);
    const row = db.prepare('SELECT * FROM login_codes WHERE email=?').get(email) as
      { hash: string; expires_at: number; attempts: number } | undefined;
    if (!row || row.expires_at <= Date.now() || row.attempts >= 5)
      throw new AppError(400, 'Code invalid or expired. Request a new code.');
    db.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE email=?').run(email);
    if (!timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(codeHash(email, code), 'hex')))
      throw new AppError(400, 'Code invalid or expired.');
    const user = db.transaction(() => {
      db.prepare('DELETE FROM login_codes WHERE email=?').run(email);
      return store.ensureUser(email);
    })();
    issueSession(user, res);
  });
  app.post('/api/auth/password', limit, async (req, res) => {
    if (emailAuth) throw new AppError(404, 'Password sign-in is disabled.');
    const { email, password } = z
      .object({ email: emailSchema, password: passwordSchema })
      .strict()
      .parse(req.body);
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email) as
      { id: string } | undefined;
    if (existing) {
      const credential = db
        .prepare('SELECT hash FROM password_credentials WHERE user_id=?')
        .get(existing.id) as { hash: string } | undefined;
      if (!credential || !(await passwordMatches(password, credential.hash)))
        throw new AppError(401, 'Email or password is incorrect.');
      issueSession(store.user(existing.id), res);
      return;
    }
    const passwordHash = await createPasswordHash(password);
    const user = db.transaction(() => {
      const user = store.ensureUser(email);
      db.prepare('INSERT INTO password_credentials(user_id,hash) VALUES (?,?)').run(
        user.id,
        passwordHash,
      );
      store.audit(user.id, 'account.created', { auth: 'password' });
      return user;
    })();
    issueSession(user, res);
  });
  const session = (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.brownbag_session;
    const row =
      typeof token === 'string'
        ? (db
            .prepare('SELECT user_id FROM sessions WHERE hash=? AND expires_at>?')
            .get(hash(token), Date.now()) as { user_id: string } | undefined)
        : undefined;
    if (!row) return next(new AppError(401, 'Sign in to continue.'));
    req.user = store.user(row.user_id);
    next();
  };
  const apiKey = (req: Request, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (bb_[A-Za-z0-9_-]+)$/)?.[1];
    const row = token
      ? (db.prepare('SELECT id,user_id,name FROM api_keys WHERE hash=?').get(hash(token)) as
          { id: string; user_id: string; name: string } | undefined)
      : undefined;
    if (!row) return next(new AppError(401, 'A valid brownbag API key is required.'));
    req.user = store.user(row.user_id);
    req.keyName = `API key: ${row.name} (${row.id.slice(0, 8)})`;
    db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?').run(
      new Date().toISOString(),
      row.id,
    );
    next();
  };
  app.get('/api/me', session, (req, res) => res.json(req.user));
  app.post('/api/auth/logout', session, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(req.cookies.brownbag_session));
    res.clearCookie('brownbag_session', cookie).json({ ok: true });
  });
  app.patch('/api/me', session, (req, res) => {
    const { yolo } = z.object({ yolo: z.boolean() }).strict().parse(req.body);
    db.transaction(() => {
      db.prepare('UPDATE users SET yolo=? WHERE id=?').run(Number(yolo), req.user.id);
      store.audit(req.user.id, 'account.yolo_changed', { enabled: yolo });
    })();
    res.json(store.user(req.user.id));
  });
  app.get('/api/keys', session, (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT id,name,prefix,created_at AS createdAt,last_used_at AS lastUsedAt FROM api_keys WHERE user_id=? ORDER BY created_at DESC',
        )
        .all(req.user.id),
    ),
  );
  app.post('/api/keys', session, (req, res) => {
    const name = z.string().trim().min(1).max(100).parse(req.body.name);
    const count = db
      .prepare('SELECT count(*) AS n FROM api_keys WHERE user_id=?')
      .get(req.user.id) as { n: number };
    if (count.n >= 50) throw new AppError(400, 'Revoke an existing key before creating another.');
    const token = `bb_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO api_keys(id,user_id,name,hash,prefix,created_at) VALUES (?,?,?,?,?,?)',
      ).run(id, req.user.id, name, hash(token), token.slice(0, 11), new Date().toISOString());
      store.audit(req.user.id, 'key.created', { id, name });
    })();
    res.status(201).json({ id, name, token });
  });
  app.delete('/api/keys/:id', session, (req, res) => {
    const result = db
      .prepare('DELETE FROM api_keys WHERE id=? AND user_id=?')
      .run(req.params.id, req.user.id);
    if (!result.changes) throw new AppError(404, 'Key not found.');
    store.audit(req.user.id, 'key.revoked', { id: req.params.id });
    res.json({ ok: true });
  });
  return { session, apiKey };
}
