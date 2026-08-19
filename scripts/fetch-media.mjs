// Mirror every asset the pages reference into public/, preserving the original
// path so srcset entries and CSS url() references keep working unchanged.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUB = path.join(ROOT, 'public');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const localPath = (u) => {
  const url = new URL(u);
  return url.host === 'trindustrialconstruction.com'
    ? path.join(PUB, url.pathname)
    : path.join(PUB, 'wp/ext', url.host, url.pathname);
};

const urls = JSON.parse(await readFile(path.join(ROOT, '_extract/assets.json'), 'utf8'));
let ok = 0, cached = 0, failed = [];
const queue = [...urls];
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const u = queue.pop();
    const out = localPath(u);
    try { if ((await stat(out)).size > 0) { cached++; continue; } } catch { /* not cached */ }
    try {
      const res = await fetch(u, { headers: { 'user-agent': UA, referer: 'https://trindustrialconstruction.com/' } });
      if (!res.ok) { failed.push([res.status, u]); continue; }
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      ok++;
    } catch (e) { failed.push([String(e), u]); }
  }
});
await Promise.all(workers);
console.log(`downloaded ${ok}, cached ${cached}, failed ${failed.length}`);
for (const [s, u] of failed) console.log('  FAIL', s, u);
