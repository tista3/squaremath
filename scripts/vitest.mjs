// Runs Vitest with a normalised working directory.
// On Windows a lowercase drive letter in the cwd (VS Code terminals, Git Bash "/c/...") makes Vitest load
// two copies of itself and every suite fails with "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const require = createRequire(path.join(cwd, 'package.json'));
const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const { status } = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(status ?? 1);
