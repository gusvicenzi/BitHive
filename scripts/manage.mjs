import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { configureData, root } from './data.mjs';
const require = createRequire(import.meta.url);
configureData();
const children = new Set();
function run(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, env: process.env, stdio: 'inherit' });
    children.add(child);
    child.on('error', reject);
    child.on('exit', code => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`Process exited: ${code}`));
    });
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const child of children) child.kill(signal);
});
const prisma = (...args) => run(require.resolve('prisma/build/index.js'), args);
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const command = process.argv[2];
try {
  if (command === 'generate') await prisma('generate');
  else if (command === 'migrate') await prisma('migrate', 'deploy');
  else if (command === 'schema') await prisma('migrate', 'dev');
  else if (command === 'start' || command === 'dev') {
    await prisma('generate');
    await prisma('migrate', 'deploy');
    if (command === 'start') {
      await run(require.resolve('typescript/bin/tsc'), ['-p', 'tsconfig.server.json']);
      await run(vite, ['build']);
      await run('dist/server/server/main.js');
    } else {
      process.env.BITHIVE_DEV = '1';
      try {
        await Promise.all([
          run(require.resolve('tsx/cli'), ['watch', 'src/server/main.ts']),
          run(vite),
        ]);
      } finally { for (const child of children) child.kill(); }
    }
  } else throw new Error('Unknown management command');
} catch (error) {
  console.error(error.message);
  for (const child of children) child.kill();
  process.exitCode = 1;
}
