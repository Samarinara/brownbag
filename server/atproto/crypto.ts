import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedValue = { version: 1; iv: string; tag: string; data: string };

/** Context binds ciphertext to its table and key, preventing row substitution. */
export function createTokenCipher(encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('OAUTH_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key');
  }
  return {
    encrypt(value: unknown, context: string): EncryptedValue {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return {
        version: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    },
    decrypt<T>(value: EncryptedValue, context: string): T {
      if (value.version !== 1) throw new Error('Unsupported encrypted OAuth value version');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(value.data, 'base64')),
          decipher.final(),
        ]).toString('utf8'),
      ) as T;
    },
  };
}
