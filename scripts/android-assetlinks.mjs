import { writeFile } from 'node:fs/promises';
const fingerprints = [...new Set(process.argv.slice(2).map((value) => value.toUpperCase()))];
if (
  !fingerprints.length ||
  fingerprints.some((value) => !/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))
) {
  console.error('Usage: npm run android:assetlinks -- SHA256_FINGERPRINT [ANOTHER_FINGERPRINT]');
  process.exit(1);
}
const statements = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'page.polli.brownbag',
      sha256_cert_fingerprints: fingerprints,
    },
  },
];
await writeFile(
  new URL('../public/.well-known/assetlinks.json', import.meta.url),
  JSON.stringify(statements, null, 2) + '\n',
);
console.log(
  'Wrote public/.well-known/assetlinks.json. Deploy the website to activate domain verification.',
);
