import { spawnSync } from 'node:child_process';
const tasks = { debug: 'assembleDebug', unsigned: 'assembleRelease' };
const mode = process.argv[2];
if (!tasks[mode]) throw new Error('Use android-build.mjs debug|unsigned');
const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : './gradlew', [tasks[mode], '--console=plain'], {
  cwd: new URL('../android/', import.meta.url),
  stdio: 'inherit',
  shell: windows,
});
if (result.error) console.error(result.error.message);
if (result.status === 0)
  console.log(
    `APK: android/app/build/outputs/apk/${mode === 'debug' ? 'debug/app-debug.apk' : 'release/app-release-unsigned.apk'}`,
  );
process.exit(result.status ?? 1);
