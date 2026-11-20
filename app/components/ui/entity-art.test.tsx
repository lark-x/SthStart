import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import { EntityArt, EntityImage } from './entity-art';
import { ENTITY_ART_TONES, entityArtSpec, entityGlyph, hashSeed } from './entity-art-model';

const render = (node: React.ReactElement) => renderToStaticMarkup(<HeadlessMantineProvider>{node}</HeadlessMantineProvider>);

test('the same entity ID always produces the same pattern, independent of renaming', () => {
  const first = entityArtSpec('world-7f3c', '海雾中的末班船');
  const again = entityArtSpec('world-7f3c', '海雾中的末班船');
  const renamed = entityArtSpec('world-7f3c', '新名字');
  assert.deepEqual(again, first);
  assert.equal(renamed.fingerprint, first.fingerprint, 'renaming keeps the pattern; only the glyph changes');
  assert.equal(renamed.glyph, '新');
  assert.equal(hashSeed('abc'), hashSeed('abc'));
});

test('different IDs spread across patterns instead of collapsing to a few looks', () => {
  const ids = Array.from({ length: 60 }, (_, index) => `activity-${index}-${index * 7919}`);
  const fingerprints = new Set(ids.map((id) => entityArtSpec(id, '制作').fingerprint));
  assert.ok(fingerprints.size >= 50, `expected at least 50 distinct patterns, got ${fingerprints.size}`);
  const variants = new Set(ids.map((id) => entityArtSpec(id, '制作').variant));
  assert.equal(variants.size, 4, 'all four pattern families are used');
  const tones = new Set(ids.map((id) => entityArtSpec(id, '制作').tone));
  assert.equal(tones.size, ENTITY_ART_TONES.length, 'without a module tone every tone appears');
});

test('module tone overrides the derived hue, and glyphs split by code point', () => {
  assert.equal(entityArtSpec('x', 'y', 'pink').tone, 'pink');
  assert.equal(entityGlyph('  林舟 '), '林');
  assert.equal(entityGlyph('alice'), 'A');
  assert.equal(entityGlyph('𠮷野家'), '𠮷', 'astral characters are not cut in half');
  assert.equal(entityGlyph(''), '');
});

test('EntityArt renders tone-driven SVG with the requested aspect ratio and stays decorative by default', () => {
  const html = render(<EntityArt seed="p-1" title="封面项目" tone="blue" ratio="portrait" />);
  assert.match(html, /data-tone="blue"/);
  assert.match(html, /aspect-ratio:3 \/ 4/);
  assert.match(html, /data-ratio="portrait"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /stroke="var\(--tone\)"|fill="var\(--tone\)"/, 'pattern colour comes from the tone token');
  assert.doesNotMatch(html, /#[0-9a-fA-F]{6}/, 'no hard-coded colours');
  const labelled = render(<EntityArt seed="p-1" title="封面项目" decorative={false} />);
  assert.match(labelled, /role="img"/);
  assert.match(labelled, /aria-label="封面项目"/);
});

test('EntityImage shows a lazy image with a same-size skeleton, or falls back to EntityArt without a source', () => {
  const withImage = render(<EntityImage seed="a-1" title="海边" src="/api/admin/media-library/x/file" ratio="cover" />);
  assert.match(withImage, /<img[^>]*loading="lazy"/);
  assert.match(withImage, /data-entity-image="image"/);
  assert.match(withImage, /skeleton-shimmer/);
  assert.match(withImage, /aspect-ratio:16 \/ 10/);
  const fallback = render(<EntityImage seed="a-1" title="海边" src={null} ratio="avatar" />);
  assert.doesNotMatch(fallback, /<img/);
  assert.match(fallback, /data-entity-image="art"/);
  assert.match(fallback, /data-entity-art="true"/);
  assert.match(fallback, /aspect-ratio:1 \/ 1/);
});
