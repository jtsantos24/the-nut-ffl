import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(import.meta.dirname, '../www');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of ['index.html', 'manifest.webmanifest', 'offline.html', 'sw.js']) {
  await cp(join(root, file), join(out, file));
}
for (const dir of ['icons', 'recaps']) {
  await cp(join(root, dir), join(out, dir), { recursive: true });
}
for (const file of await readdir(root)) {
  if (file.endsWith('.webp') && (await stat(join(root, file))).isFile()) {
    await cp(join(root, file), join(out, file));
  }
}
console.log('Copied league site into mobile/www');
