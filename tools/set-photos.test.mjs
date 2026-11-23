import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../src/views/exploreSets.js', import.meta.url), 'utf8');
const section = source.split('// ---------- card details')[0].replace(/^import .*;$/gm, '').replace(/export /g, '').replace(/import\.meta\.env\.BASE_URL/g, "'/'");
const render = vm.runInNewContext(section + '\nsetIcon', { esc: (s) => String(s).replaceAll('"', '&quot;') });
test('set tiles render a real local product photo without drawn box art, even on a fresh Home visit', () => {
  const html = render({id:'op17',name:"The World's Strongest Warriors"});
  assert.match(html, /<img\b[^>]*src="\/sets\/op17\.webp"/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /width="400"/);
  assert.match(html, /height="400"/);
  assert.match(html, /loading="lazy"/);
});
test('every catalogue set has its own checked-in WebP photo and source provenance', () => {
  const sets = Object.keys(JSON.parse(readFileSync(new URL('../public/catalog.json', import.meta.url), 'utf8')).sets);
  const manifest = new URL('../public/sets/sources.json', import.meta.url);
  assert.ok(existsSync(manifest), 'product-photo provenance manifest is missing');
  const sources = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.deepEqual(Object.keys(sources).sort(), sets.sort());
  for (const id of sets) {
    const file = new URL(`../public/sets/${id}.webp`, import.meta.url);
    assert.ok(existsSync(file), `${id} photo is missing`);
    const bytes = readFileSync(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${id} must be an actual image`);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.match(sources[id].image_url, /^https:\/\//);
    assert.match(sources[id].source_url, /^https:\/\//);
    assert.match(render({id}), new RegExp(`sets/${id}\\.webp`));
  }
});
