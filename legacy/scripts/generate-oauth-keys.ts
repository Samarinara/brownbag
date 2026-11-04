import { generateKeyPairSync, randomBytes } from 'node:crypto';
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = {
  ...privateKey.export({ format: 'jwk' }),
  kid: randomBytes(12).toString('hex'),
  alg: 'ES256',
  use: 'sig',
};
console.info('# Store these values as secrets; never commit them.');
console.info(`OAUTH_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.info(`OAUTH_PRIVATE_KEY_JWK='${JSON.stringify(jwk)}'`);
