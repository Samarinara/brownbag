import { runMaintenance } from './maintenance.js';

runMaintenance().catch(() => {
  // Driver errors can contain connection details; keep credentials out of operator logs.
  console.error('Database maintenance failed. Check configuration and database availability.');
  process.exitCode = 1;
});
