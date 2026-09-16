#!/usr/bin/env node
/**
 * Runs jest with `--experimental-vm-modules`.
 *
 * pdf-parse loads its pdf.js worker through a dynamic `import()`, which jest's
 * CJS sandbox refuses without that flag ("A dynamic import callback was invoked
 * without --experimental-vm-modules") — so the PDF extraction tests can only
 * exercise the real parser with it on. Doing it here rather than inline in the
 * npm script keeps it working on Windows, where `FOO=bar cmd` is not a thing,
 * and resolves jest whether it is hoisted to the workspace root or installed
 * beside this package.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// jest's package exports do not expose ./bin/jest.js, so the CLI is located
// from the resolved entry point's package directory instead.
const entry = require.resolve('jest');
const packageRoot = entry.slice(0, entry.lastIndexOf(`${path.sep}jest${path.sep}`) + 6);
const jest = path.join(packageRoot, 'bin', 'jest.js');

const child = spawn(process.execPath, ['--experimental-vm-modules', jest, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
