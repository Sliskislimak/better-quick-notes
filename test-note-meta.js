// Browserless checks for note-meta.js. Run: node test-note-meta.js
const assert = require('assert');
const api = require('./note-meta.js');

const page = {
  title: 'Hello "World"',
  source: 'https://example.com/a?q=1',
  domain: 'example.com',
  now: '2026-11-02T16:00:00.000Z'
};

const created = api.upsertFrontmatter('Line one\nLine two', page, { allowCreate: true });
assert.strictEqual(created.startsWith('---\n'), true);
assert.strictEqual((created.match(/^---/gm) || []).length, 2);
assert.strictEqual(api.bodyOf(created), 'Line one\nLine two');
assert.ok(created.includes('title: "Hello \\"World\\""'));
assert.ok(created.includes('source: "https://example.com/a?q=1"'));
assert.ok(created.includes('domain: "example.com"'));
assert.ok(created.includes('created: "2026-11-02T16:00:00.000Z"'));
assert.ok(created.includes('updated: "2026-11-02T16:00:00.000Z"'));
assert.ok(created.includes('  - quicknotes'));
assert.ok(created.includes('  - web-clip'));

const parsed = api.splitFrontmatter(created);
assert.strictEqual(parsed.fields.title, 'Hello "World"');
assert.strictEqual(parsed.fields.created, '2026-11-02T16:00:00.000Z');

const edited = created.replace('Line one', 'Line one edited');
const laterSamePage = Object.assign({}, page, {
  title: 'Renamed tab',
  now: '2026-11-02T17:00:00.000Z'
});
const updated = api.upsertFrontmatter(edited, laterSamePage, { allowCreate: true });
assert.strictEqual((updated.match(/^---/gm) || []).length, 2);
assert.strictEqual(api.bodyOf(updated), 'Line one edited\nLine two');
assert.ok(updated.includes('created: "2026-11-02T16:00:00.000Z"'));
assert.ok(updated.includes('updated: "2026-11-02T17:00:00.000Z"'));
assert.ok(updated.includes('title: "Renamed tab"'));
assert.ok(updated.includes('source: "https://example.com/a?q=1"'));

const otherPage = {
  title: 'Other',
  source: 'https://other.test/path',
  domain: 'other.test',
  now: '2026-11-02T18:00:00.000Z'
};
const kept = api.upsertFrontmatter(updated, otherPage, { allowCreate: true });
assert.ok(kept.includes('title: "Renamed tab"'));
assert.ok(kept.includes('source: "https://example.com/a?q=1"'));
assert.ok(kept.includes('domain: "example.com"'));
assert.ok(kept.includes('updated: "2026-11-02T18:00:00.000Z"'));
assert.strictEqual(api.bodyOf(kept), 'Line one edited\nLine two');

const dirty = api.upsertFrontmatter('Body', {
  title: 'A\u0001B "q"',
  source: 'https://ex.test/',
  domain: 'ex.test',
  now: '2026-11-02T16:00:00.000Z'
}, { allowCreate: true });
assert.strictEqual(api.splitFrontmatter(dirty).fields.title, 'AB "q"');

const half = '---\nnot closed yet';
assert.strictEqual(api.upsertFrontmatter(half, page, { allowCreate: true }), half);
assert.strictEqual(api.hasFrontmatter(half), false);

const plain = 'Just a note';
assert.strictEqual(api.upsertFrontmatter(plain, page, { allowCreate: false }), plain);

const withExtra = [
  '---',
  'title: "Old"',
  'source: "https://example.com/a?q=1"',
  'domain: "example.com"',
  'created: "2020-01-01T00:00:00.000Z"',
  'updated: "2020-01-01T00:00:00.000Z"',
  'mood: "calm"',
  'tags:',
  '  - quicknotes',
  '  - inbox',
  '---',
  'Body'
].join('\n');
const merged = api.upsertFrontmatter(withExtra, laterSamePage, { allowCreate: true });
assert.ok(merged.includes('mood: "calm"'));
assert.ok(merged.includes('  - inbox'));
assert.ok(merged.includes('  - web-clip'));
assert.strictEqual((merged.match(/- quicknotes/g) || []).length, 1);
assert.ok(merged.includes('created: "2020-01-01T00:00:00.000Z"'));
assert.strictEqual(api.bodyOf(merged), 'Body');

const applied = api.applyEditorFrontmatter('Hello', page, { start: 0, end: 0 }, { allowCreate: true });
assert.strictEqual(applied.touchedEditor, true);
assert.strictEqual(applied.editorValue.slice(applied.selectionStart), 'Hello');
const again = api.applyEditorFrontmatter(applied.markdown, laterSamePage, { start: 3, end: 3 }, { allowCreate: true });
assert.strictEqual(again.touchedEditor, false);
assert.strictEqual(again.selectionStart, 3);
assert.notStrictEqual(again.markdown, applied.markdown);

assert.strictEqual(api.sanitizeFileTitle('My: Note?.'), 'My- Note-');
assert.strictEqual(api.sanitizeFileTitle('report.pdf.'), 'report.pdf');
assert.strictEqual(api.sanitizeFileTitle('  hello   '), '  hello');
assert.strictEqual(api.sanitizeFileTitle('...'), 'note');
assert.strictEqual(api.sanitizeFileTitle('a/b\u0000c'), 'a-bc');
assert.strictEqual(api.sanitizeFileTitle(''), 'note');
assert.strictEqual(api.vaultFileName('My: Note?.', 'abcdef123'), 'My- Note-_abcdef.md');
assert.strictEqual(api.driveFileName('My: Note?.'), 'My- Note-.md');
assert.strictEqual(api.vaultFileName('', 'xyz'), 'note_xyz.md');

console.log('note-meta checks passed');
