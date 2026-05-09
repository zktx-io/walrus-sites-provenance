import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const lockPath = new URL('../upstream-lock.json', import.meta.url);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

let failed = false;

const getExpectedPackageVersion = release => {
  const match = /^(@[^@]+\/[^@]+|[^@]+)@(.+)$/.exec(release);
  return match?.[2];
};

for (const upstream of lock.upstreams ?? []) {
  if (!fs.existsSync(upstream.localPath)) {
    console.error(
      `[upstream-lock] Missing ${upstream.name} at ${upstream.localPath}. Run npm run sync:upstream first.`,
    );
    failed = true;
    continue;
  }

  let actual;
  try {
    actual = execFileSync('git', ['-C', upstream.localPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    console.error(`[upstream-lock] ${upstream.localPath} is not a readable git checkout`);
    failed = true;
    continue;
  }

  if (actual !== upstream.commit) {
    console.error(
      `[upstream-lock] ${upstream.name} is at ${actual}, expected ${upstream.commit}`,
    );
    failed = true;
  } else {
    console.log(`[upstream-lock] ${upstream.name} OK (${actual})`);
  }

  if (upstream.packagePath) {
    const packageJsonPath = `${upstream.packagePath}/package.json`;
    if (!fs.existsSync(packageJsonPath)) {
      console.error(`[upstream-lock] Missing package.json for ${upstream.name} at ${packageJsonPath}`);
      failed = true;
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const expectedPackageVersion = getExpectedPackageVersion(upstream.release);
    if (expectedPackageVersion && packageJson.version !== expectedPackageVersion) {
      console.error(
        `[upstream-lock] ${upstream.name} package version is ${packageJson.version}, expected ${expectedPackageVersion}`,
      );
      failed = true;
    } else if (expectedPackageVersion) {
      console.log(`[upstream-lock] ${upstream.name} package version OK (${packageJson.version})`);
    }
  }
}

if (failed) {
  process.exitCode = 1;
}
