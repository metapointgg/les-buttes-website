import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    entry.isDirectory() ? walk(path) : files.push(path);
  }
}

walk(root);

const failures = [];

function target(url) {
  const clean = url.split(/[?#]/)[0];
  if (!clean || clean.startsWith('#') || /^[a-z]+:/i.test(clean) || clean.startsWith('//')) return null;

  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Leave malformed URLs untouched so the normal existence check reports them.
  }

  const path = decoded.startsWith('/') ? decoded.slice(1) : decoded;
  if (!path) return join(root, 'index.html');
  if (path.endsWith('/')) return join(root, path, 'index.html');
  if (!extname(path)) return join(root, path, 'index.html');
  return join(root, path);
}

const html = files.filter((file) => extname(file) === '.html');

for (const file of html) {
  const source = readFileSync(file, 'utf8');
  const name = relative(root, file);

  if ((source.match(/<h1[\s>]/g) || []).length !== 1) failures.push(`${name}: invalid h1 count`);
  if ((source.match(/<link rel="canonical"/g) || []).length !== 1) failures.push(`${name}: invalid canonical count`);

  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const fileTarget = target(match[1]);
    if (fileTarget && !existsSync(fileTarget)) failures.push(`${name}: missing ${match[1]}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Checked ${html.length} HTML files: links, assets, h1s and canonicals are valid.`);
