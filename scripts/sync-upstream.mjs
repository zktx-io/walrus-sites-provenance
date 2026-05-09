import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lockPath = new URL('../upstream-lock.json', import.meta.url);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const runGit = (args, options = {}) => {
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
};

const getGitOutput = args =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const requireCleanWorktree = upstream => {
  const status = getGitOutput(['-C', upstream.localPath, 'status', '--porcelain']);
  if (!status) return true;

  if (process.env.UPSTREAM_SYNC_FORCE === '1') {
    console.warn(
      `[upstream-sync] ${upstream.localPath} has local changes; UPSTREAM_SYNC_FORCE=1 allows cleanup.`,
    );
    return true;
  }

  console.error(`[upstream-sync] ${upstream.localPath} has local changes:`);
  console.error(status);
  console.error('[upstream-sync] Refusing to overwrite local upstream notes.');
  console.error('[upstream-sync] Re-run with UPSTREAM_SYNC_FORCE=1 to discard changes in .walrus/.');
  return false;
};

let failed = false;

for (const upstream of lock.upstreams ?? []) {
  const localPath = path.resolve(root, upstream.localPath);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  if (!fs.existsSync(localPath)) {
    console.log(`[upstream-sync] cloning ${upstream.name} into ${upstream.localPath}`);
    runGit(['clone', '--filter=blob:none', '--no-checkout', upstream.repository, upstream.localPath]);
  } else {
    console.log(`[upstream-sync] updating ${upstream.name} in ${upstream.localPath}`);
    runGit(['-C', upstream.localPath, 'remote', 'set-url', 'origin', upstream.repository]);
    if (!requireCleanWorktree(upstream)) {
      failed = true;
      continue;
    }
  }

  runGit(['-C', upstream.localPath, 'fetch', '--depth', '1', 'origin', upstream.commit]);
  runGit(['-C', upstream.localPath, 'checkout', '--detach', upstream.commit]);
  runGit(['-C', upstream.localPath, 'clean', '-fdx']);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('[upstream-sync] upstream cache matches upstream-lock.json');
}
