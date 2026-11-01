// node --test site/
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_GAME_URL, build, checkUrl, parseControls, renderKey, renderPage } from './build.mjs';

const README = `# X

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Tab (hold) | Scoreboard |
| 1 / 2 | Primary / secondary |

Some prose.

## Testing
| not | this |
`;

test('parseControls reads only the Controls table, without header or separator', () => {
  assert.deepEqual(parseControls(README), [
    ['WASD', 'Move'],
    ['Tab (hold)', 'Scoreboard'],
    ['1 / 2', 'Primary / secondary'],
  ]);
});

test('parseControls fails loudly when the section is missing', () => {
  assert.throws(() => parseControls('# nothing here'), /Controls/);
});

test('renderKey splits alternatives and keeps qualifiers as text', () => {
  assert.equal(renderKey('WASD'), '<kbd>WASD</kbd>');
  assert.equal(renderKey('1 / 2'), '<kbd>1</kbd> / <kbd>2</kbd>');
  assert.equal(renderKey('Tab (hold)'), '<kbd>Tab</kbd> (hold)');
  assert.equal(renderKey('[ / ]'), '<kbd>[</kbd> / <kbd>]</kbd>');
  assert.equal(renderKey('<x>'), '<kbd>&lt;x&gt;</kbd>');
});

test('renderPage refuses to leave a placeholder unfilled', () => {
  assert.throws(() => renderPage('{{GAME_URL}} {{NOPE}}', { gameUrl: 'a', repoUrl: 'b', controls: '' }), /NOPE/);
});

test('checkUrl accepts http(s) and rejects anything else', () => {
  assert.equal(checkUrl('X', 'https://example.com'), 'https://example.com/');
  assert.throws(() => checkUrl('X', 'javascript:alert(1)'), /http/);
  assert.throws(() => checkUrl('X', 'not a url'), /valid URL/);
});

test('build writes a complete page from the real README', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cs2d-site-'));
  try {
    build({ outDir, env: {} });
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.ok(html.includes(`href="${DEFAULT_GAME_URL}"`), 'Play now points at the live game');
    assert.ok(html.includes('<kbd>WASD</kbd>'), 'controls table came from README');
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'no placeholders left');
    for (const asset of ['styles.css', 'img/fog.jpg', 'img/spawn.jpg', 'img/buy.jpg', 'img/menu.jpg', '.nojekyll']) {
      assert.ok(existsSync(join(outDir, asset)), `${asset} copied`);
    }
    // every local src/href in the page resolves to a built file
    for (const [, ref] of html.matchAll(/(?:src|href)="(?!https?:|#|data:)([^"]+)"/g)) {
      assert.ok(existsSync(join(outDir, ref)), `${ref} exists`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('build honours CS2D_GAME_URL', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cs2d-site-'));
  try {
    build({ outDir, env: { CS2D_GAME_URL: 'https://play.example.com/' } });
    assert.ok(readFileSync(join(outDir, 'index.html'), 'utf8').includes('href="https://play.example.com/"'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
