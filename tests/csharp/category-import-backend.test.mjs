import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let captured;
const generator = readFileSync(resolve(root, 'scripts/generate-import.mjs'), 'utf8')
  .replace(/^import .+;\r?\n/gm, '')
  .replaceAll('import.meta.dirname', 'generatorDirectory');
new Function('readFileSync', 'writeFileSync', 'resolve', 'gzipSync', 'generatorDirectory', 'console', generator)(
  readFileSync, (_path, contents) => { captured = contents; }, resolve, gzipSync, resolve(root, 'scripts'), {log() {}});
const bytes = Buffer.from(captured.trim(), 'base64');
assert.equal(bytes.subarray(0, 4).toString(), 'SBAE');
const exported = JSON.parse(gunzipSync(bytes.subarray(4)));
const action = exported.data.actions[0];
assert.equal(action.id, '9c4b1bc3-e5d8-458d-9171-69e74c89289a');
assert.equal(action.actions[0].id, '008b1b1d-569b-4534-bf65-cd51d54fa826');
assert.equal(action.actions[0].references.length, 5);
const code = Buffer.from(action.actions[0].byteCode, 'base64').toString('utf8');
assert.ok(code.includes('public sealed class TwitchCategorySearchService'), 'Generated action must include search service');
assert.ok(code.includes('public static class TwitchCategoryTransport'), 'Generated action must include actual HTTP transport');
assert.ok(code.includes('using System.Threading.Tasks;'), 'Generated action must retain all helper imports');
assert.equal((code.match(/^using System;/gm) || []).length, 1);
assert.equal((code.match(/^using System.Threading.Tasks;/gm) || []).length, 1);
assert.ok(!/^using /m.test(code.slice(code.indexOf('public class CPHInline'))), 'Usings must precede all classes');
console.log('Backend import generation passed: helpers, deduplicated usings, preserved references and IDs; no files written.');
