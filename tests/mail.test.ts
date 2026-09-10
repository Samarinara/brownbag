import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { createSmtpMailer, readSmtpConfig } from '../server/mail.js';

test('SMTP configuration validates credentials, ports, sender and TLS settings', () => {
  const env = { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'brownbag <login@example.com>' };
  assert.equal(readSmtpConfig(env).requireTLS, true);
  assert.equal(readSmtpConfig(env).port, 587);
  assert.equal(readSmtpConfig({ ...env, SMTP_SECURE: 'true' }).port, 465);
  assert.equal(readSmtpConfig({ ...env, SMTP_REQUIRE_TLS: 'false' }).requireTLS, false);
  assert.deepEqual(readSmtpConfig({ ...env, SMTP_USER: 'user', SMTP_PASSWORD: 'secret' }).auth, {
    user: 'user',
    pass: 'secret',
  });
  for (const invalid of [
    { SMTP_HOST: '' },
    { SMTP_FROM: '' },
    { SMTP_FROM: 'sender@example.com\r\nBcc: other@example.com' },
    { SMTP_PORT: '0' },
    { SMTP_PORT: '65536' },
    { SMTP_PORT: 'abc' },
    { SMTP_SECURE: 'yes' },
    { SMTP_REQUIRE_TLS: 'no' },
    { SMTP_USER: 'user' },
    { SMTP_PASSWORD: 'secret' },
  ])
    assert.throws(() => readSmtpConfig({ ...env, ...invalid }));
});

// Exercise Nodemailer's real network transport without sending external mail.
async function smtpFixture() {
  const messages: string[] = [];
  const recipients: string[] = [];
  const senders: string[] = [];
  const sockets = new Set<Socket>();
  let rejectRecipient = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let data: string[] | undefined;
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = undefined;
            socket.write('250 Message accepted\r\n');
          } else data.push(line.replace(/^\.\./, '.'));
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write('250 localhost\r\n');
        } else if (/^MAIL FROM:/i.test(line)) {
          senders.push(line);
          socket.write('250 Sender accepted\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line);
          socket.write(
            rejectRecipient ? '550 Recipient rejected\r\n' : '250 Recipient accepted\r\n',
          );
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 End with a dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('502 Command not implemented\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    messages,
    recipients,
    senders,
    config: readSmtpConfig({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String((server.address() as AddressInfo).port),
      SMTP_FROM: 'brownbag <login@example.com>',
      SMTP_REQUIRE_TLS: 'false',
    }),
    rejectRecipients(value: boolean) {
      rejectRecipient = value;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test('sign-in sends through SMTP; rejected delivery clears the code and permits retry', async (t) => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const app = createApp(store, {
    production: true,
    origin: 'http://localhost:3000',
    mailMode: 'smtp',
    smtp: smtp.config,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  await createSmtpMailer(smtp.config).verify();
  assert.equal(smtp.messages.length, 0);
  const email = 'reader@example.com';
  const sent = await post('/api/auth/code', { email });
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true });
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.senders[0], /<login@example.com>/);
  assert.match(smtp.recipients[0], /<reader@example.com>/);
  assert.match(smtp.messages[0], /Subject: Your brownbag sign-in code/);
  assert.match(smtp.messages[0], /expires in 10 minutes/);
  const code = smtp.messages[0].match(/code is (\d{8})/)?.[1];
  assert.ok(code);
  const verified = await post('/api/auth/verify', { email, code });
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get('set-cookie')!, /brownbag_session=/);

  smtp.rejectRecipients(true);
  const retryEmail = 'retry@example.com';
  const failed = await post('/api/auth/code', { email: retryEmail });
  assert.equal(failed.status, 503);
  assert.equal(
    store.db.prepare('SELECT * FROM login_codes WHERE email=?').get(retryEmail),
    undefined,
  );
  smtp.rejectRecipients(false);
  assert.equal((await post('/api/auth/code', { email: retryEmail })).status, 200);
  assert.equal(smtp.messages.length, 2);
});

test('SMTP refuses delivery when required STARTTLS is unavailable', async (t) => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  await assert.rejects(
    createSmtpMailer({ ...smtp.config, requireTLS: true }).sendCode(
      'reader@example.com',
      '12345678',
    ),
  );
  assert.equal(smtp.messages.length, 0);
});
