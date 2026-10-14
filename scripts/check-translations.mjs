import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = lang => JSON.parse(readFileSync(new URL(`../src/web/locales/${lang}.json`, import.meta.url), 'utf8'));
function flatten(object, prefix = '') {
  return Object.fromEntries(Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : Object.entries(flatten(value, path));
  }));
}
const en = flatten(read('en'));
const pt = flatten(read('pt-BR'));
assert.deepEqual(Object.keys(en).sort(), Object.keys(pt).sort(), 'Translation keys differ');
for (const [key, value] of Object.entries(en)) {
  assert.ok(pt[key].trim(), `Empty translation: ${key}`);
  const placeholders = s => [...s.matchAll(/{{(\w+)}}/g)].map(m => m[1]).sort();
  assert.deepEqual(placeholders(value), placeholders(pt[key]), `Placeholders differ: ${key}`);
}
for (const file of readdirSync(new URL('../src/web/', import.meta.url)).filter(file => /\.(ts|tsx)$/.test(file))) {
  const source = readFileSync(new URL(`../src/web/${file}`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) assert.ok(en[match[1]], `Missing base key ${match[1]} in ${file}`);
}
console.log(`Translation coverage verified: ${Object.keys(en).length} keys in both languages.`);
