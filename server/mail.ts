import nodemailer from 'nodemailer';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  from: string;
  auth?: { user: string; pass: string };
};

export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host) throw new Error('SMTP_HOST is required to send email. See .env.example.');
  if (!from || /[\r\n]/.test(from))
    throw new Error('Set SMTP_FROM to your mail provider’s verified sender address.');
  const boolean = (name: string, fallback: boolean) => {
    const value = env[name]?.trim();
    if (!value) return fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`);
    return value === 'true';
  };
  const secure = boolean('SMTP_SECURE', false);
  const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass))
    throw new Error(
      'Set both SMTP_USER and SMTP_PASSWORD, or neither for an unauthenticated relay.',
    );
  return {
    host,
    port,
    secure,
    requireTLS: boolean('SMTP_REQUIRE_TLS', true),
    from,
    auth: user && pass ? { user, pass } : undefined,
  };
}

export function createSmtpMailer(config: SmtpConfig) {
  const { from, ...options } = config;
  const transport = nodemailer.createTransport({
    ...options,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    verify: () => transport.verify(),
    async sendCode(email: string, code: string) {
      const result = await transport.sendMail({
        from,
        to: email,
        subject: 'Your brownbag sign-in code',
        text: `Your brownbag sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
      });
      if (!result.accepted.length) throw new Error('SMTP server did not accept the recipient.');
    },
  };
}
