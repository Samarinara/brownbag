import 'dotenv/config';
import { createSmtpMailer, readSmtpConfig } from './mail.js';

try {
  await createSmtpMailer(readSmtpConfig()).verify();
  console.info('SMTP connection and authentication succeeded. No email was sent.');
} catch (error) {
  console.error('SMTP check failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
