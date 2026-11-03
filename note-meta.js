// note-meta.js · page metadata, YAML frontmatter, and export filenames.
//
// Editor approach: Quick Notes edits raw Markdown in a <textarea>
// (content.js and popup.js), not a rich-text surface. Frontmatter is kept
// inside note.content so chrome.storage, the local vault .md file, and the
// Drive file are the same string. The textarea may show the block at the top.
// Autosave rebuilds that one block in place (it never inserts a second one)
// and does not write a timestamp-only refresh back into a focused textarea —
// assigning textarea.value would wipe undo and move the caret. The first time
// a block is prepended, the editor value is updated and the caret is shifted
// by the prefix length so typing continues in the body. Preview and note
// titles use bodyOf() so the YAML is not treated as the note's first line.
// There is no separate frontmatter store.

(function (root) {
  const KNOWN_KEYS = new Set(['title', 'source', 'domain', 'created', 'updated', 'tags']);

  function escapeYamlQuoted(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  function unquoteScalar(value) {
    let v = String(value == null ? '' : value).trim();
    if (v.length >= 2) {
      const q = v[0];
      if ((q === '"' || q === "'") && v[v.length - 1] === q) {
        v = v.slice(1, -1);
        if (q === '"') v = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return v;
  }

  function parseYamlFields(yaml) {
    const fields = {
      title: '',
      source: '',
      domain: '',
      created: '',
      updated: '',
      tags: [],
      extras: []
    };
    const lines = String(yaml || '').split(/\r?\n/);
    let inTags = false;
    for (const line of lines) {
      if (!line.trim() || /^\s*#/.test(line)) {
        inTags = false;
        continue;
      }
      if (inTags) {
        const tagLine = line.match(/^\s+-\s+(.*)$/);
        if (tagLine) {
          const tag = unquoteScalar(tagLine[1]);
          if (tag) fields.tags.push(tag);
          continue;
        }
        inTags = false;
      }
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const raw = kv[2].trim();
      if (key === 'tags') {
        const inline = raw.match(/^\[([\s\S]*)\]$/);
        if (inline) {
          inline[1].split(',').forEach((part) => {
            const tag = unquoteScalar(part);
            if (tag) fields.tags.push(tag);
          });
        } else if (!raw) {
          inTags = true;
        } else {
          const tag = unquoteScalar(raw);
          if (tag) fields.tags.push(tag);
        }
        continue;
      }
      const value = unquoteScalar(raw);
      if (key === 'title' || key === 'source' || key === 'domain' || key === 'created' || key === 'updated') {
        fields[key] = value;
      } else if (!KNOWN_KEYS.has(key)) {
        fields.extras.push({ key, value });
      }
    }
    return fields;
  }

  // Returns null when the text has no opening fence.
  // incomplete: true when a fence was started but not closed — callers must
  // not prepend a second block on top of a half-typed one.
  function splitFrontmatter(markdown) {
    const text = String(markdown == null ? '' : markdown).replace(/^\uFEFF/, '');
    if (!/^---[ \t]*\r?\n/.test(text)) {
      if (text.startsWith('---')) return { incomplete: true, body: text, fields: null };
      return null;
    }
    const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) return { incomplete: true, body: text, fields: null };
    return {
      incomplete: false,
      yaml: match[1],
      body: text.slice(match[0].length),
      fields: parseYamlFields(match[1])
    };
  }

  function formatTag(tag) {
    const clean = escapeYamlQuoted(tag);
    if (!clean) return null;
    if (/[:#{}[\],&*!|>%@`]|^\s|\s$|^['"]/.test(clean)) return '"' + clean + '"';
    return clean;
  }

  function buildFrontmatter(fields) {
    const tags = [];
    (fields.tags || []).forEach((tag) => {
      if (tag && tags.indexOf(tag) === -1) tags.push(tag);
    });
    if (tags.indexOf('quicknotes') === -1) tags.push('quicknotes');
    if (tags.indexOf('web-clip') === -1) tags.push('web-clip');

    const lines = [
      '---',
      'title: "' + escapeYamlQuoted(fields.title) + '"',
      'source: "' + escapeYamlQuoted(fields.source) + '"',
      'domain: "' + escapeYamlQuoted(fields.domain) + '"',
      'created: "' + escapeYamlQuoted(fields.created) + '"',
      'updated: "' + escapeYamlQuoted(fields.updated) + '"'
    ];
    (fields.extras || []).forEach((extra) => {
      if (!extra || !extra.key || KNOWN_KEYS.has(extra.key)) return;
      lines.push(extra.key + ': "' + escapeYamlQuoted(extra.value) + '"');
    });
    lines.push('tags:');
    tags.forEach((tag) => {
      const rendered = formatTag(tag);
      if (rendered) lines.push('  - ' + rendered);
    });
    lines.push('---');
    return lines.join('\n') + '\n';
  }

  function hasFrontmatter(markdown) {
    const split = splitFrontmatter(markdown);
    return !!(split && !split.incomplete);
  }

  function bodyOf(markdown) {
    const split = splitFrontmatter(markdown);
    if (!split || split.incomplete) return String(markdown == null ? '' : markdown);
    return split.body;
  }

  // page: { title, source, domain, now } or null.
  // options.allowCreate — when false, do not prepend a block that is not
  // already there (popup saves). When a block exists, always refresh updated,
  // preserve created, and refresh title/source/domain only when the note is
  // still bound to this page (no source yet, or source === page.source).
  function upsertFrontmatter(markdown, page, options) {
    const opts = options || {};
    const allowCreate = opts.allowCreate !== false;
    const now = (page && page.now) || new Date().toISOString();
    const split = splitFrontmatter(markdown);

    if (!split || split.incomplete) {
      if (split && split.incomplete) return String(markdown == null ? '' : markdown);
      if (!allowCreate || !page) return String(markdown == null ? '' : markdown);
      const block = buildFrontmatter({
        title: page.title || '',
        source: page.source || '',
        domain: page.domain || '',
        created: now,
        updated: now,
        tags: ['quicknotes', 'web-clip'],
        extras: []
      });
      return block + String(markdown == null ? '' : markdown);
    }

    const prev = split.fields;
    let title = prev.title || '';
    let source = prev.source || '';
    let domain = prev.domain || '';
    if (page) {
      const bound = !source || source === page.source;
      if (bound) {
        title = page.title || '';
        source = page.source || '';
        domain = page.domain || '';
      }
    }
    const block = buildFrontmatter({
      title,
      source,
      domain,
      created: prev.created || now,
      updated: now,
      tags: prev.tags,
      extras: prev.extras
    });
    return block + split.body;
  }

  // Pure prefix insert: shift the caret so the first prepend does not drop
  // the user inside the YAML. Later saves leave the textarea alone.
  function applyEditorFrontmatter(raw, page, selection, options) {
    const next = upsertFrontmatter(raw, page, options);
    const had = hasFrontmatter(raw);
    const has = hasFrontmatter(next);
    const start = selection && typeof selection.start === 'number' ? selection.start : 0;
    const end = selection && typeof selection.end === 'number' ? selection.end : start;
    if (next !== raw && !had && has) {
      const delta = next.length - String(raw == null ? '' : raw).length;
      return {
        markdown: next,
        editorValue: next,
        selectionStart: start + delta,
        selectionEnd: end + delta,
        touchedEditor: true
      };
    }
    return {
      markdown: next,
      editorValue: String(raw == null ? '' : raw),
      selectionStart: start,
      selectionEnd: end,
      touchedEditor: false
    };
  }

  // OS filename stem. Replaces <>:"/\|?* with hyphens, strips controls and
  // trailing dots/spaces. Empty result becomes "note". Capped so the full
  // vault name stays inside common path limits.
  function sanitizeFileTitle(title) {
    let s = String(title == null ? '' : title).replace(/[\u0000-\u001F\u007F]/g, '');
    s = s.replace(/[<>:"/\\|?*]/g, '-');
    s = s.replace(/[. ]+$/g, '');
    if (!s) s = 'note';
    if (s.length > 80) s = s.slice(0, 80).replace(/[. ]+$/g, '');
    if (!s) s = 'note';
    return s;
  }

  function vaultFileName(title, noteId) {
    const id = String(noteId == null ? '' : noteId).slice(0, 6) || 'note';
    return sanitizeFileTitle(title) + '_' + id + '.md';
  }

  function driveFileName(title) {
    return sanitizeFileTitle(title) + '.md';
  }

  const api = {
    escapeYamlQuoted,
    splitFrontmatter,
    buildFrontmatter,
    hasFrontmatter,
    bodyOf,
    upsertFrontmatter,
    applyEditorFrontmatter,
    sanitizeFileTitle,
    vaultFileName,
    driveFileName
  };

  root.QN_NoteMeta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
