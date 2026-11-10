// Stop the Video Scripter server that is already running on the port, then start a fresh one.
//
//   npm run restart              same as `npm start`, after stopping the previous run
//   npm run restart -- --watch   same as `npm run dev`, after stopping the previous run
//
// It only ever stops this app: a process is stopped when it is `node ... server.mjs` started from
// this folder. Anything else on the port is left alone and reported, and nothing is started.
// macOS and Linux only (it uses lsof and ps).

import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3789;
const watch = process.argv.includes('--watch');

if (process.platform === 'win32') {
  console.error('restart: not supported on Windows. Stop the running server (Ctrl+C), then run `npm start`.');
  process.exit(1);
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return ''; // lsof and ps exit non-zero when they find nothing
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const listeners = () => [...new Set(run('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t']).split('\n').filter(Boolean).map(Number))];
const commandOf = (pid) => run('ps', ['-o', 'command=', '-p', String(pid)]);
const parentOf = (pid) => Number(run('ps', ['-o', 'ppid=', '-p', String(pid)])) || 0;
const cwdOf = (pid) => run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find((line) => line.startsWith('n'))?.slice(1) || '';
const isOurs = (pid) => /\bserver\.mjs\b/.test(commandOf(pid)) && path.resolve(cwdOf(pid) || '/') === ROOT;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function stop(pid) {
  // `node --watch` keeps a parent that would start the server again on the next file change: stop that too.
  const parent = parentOf(pid);
  const targets = parent > 1 && /--watch\b/.test(commandOf(parent)) && isOurs(parent) ? [parent, pid] : [pid];
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const target of targets) {
      try {
        process.kill(target, signal);
      } catch {
        // already gone
      }
    }
    for (let waited = 0; waited < 5000; waited += 100) {
      if (!targets.some(alive)) return;
      await sleep(100);
    }
  }
}

const found = listeners();
const foreign = found.filter((pid) => !isOurs(pid));
if (foreign.length) {
  for (const pid of foreign) console.error(`restart: port ${PORT} is used by another program (pid ${pid}: ${commandOf(pid) || 'unknown'}). It was left running.`);
  console.error(`restart: free the port, or choose another one: PORT=${PORT + 1} npm run restart`);
  process.exit(1);
}
for (const pid of found) {
  console.log(`restart: stopping the previous run (pid ${pid})`);
  await stop(pid);
}
for (let waited = 0; listeners().length && waited < 3000; waited += 100) await sleep(100);
if (listeners().length) {
  console.error(`restart: port ${PORT} is still in use, so nothing was started.`);
  process.exit(1);
}
if (!found.length) console.log(`restart: nothing was running on port ${PORT}`);

const child = spawn(process.execPath, [...(watch ? ['--watch'] : []), 'server.mjs'], { cwd: ROOT, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
