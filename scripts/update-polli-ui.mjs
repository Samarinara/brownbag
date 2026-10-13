import { execFileSync } from 'node:child_process';

// Install the published package through the registry configured for @samarinara.
// Credentials, when required by that registry, come from the environment/.npmrc.
execFileSync('npm', ['install', '@samarinara/polli-ui@latest', '--save-exact'], {
  stdio: 'inherit',
});
console.info('Installed the latest published Polli UI package.');
