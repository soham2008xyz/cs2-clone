// node --test site/
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_GA_MEASUREMENT_ID,
  DEFAULT_GAME_URL,
  DEFAULT_SITE_URL,
  build,
  checkUrl,
  parseControls,
  renderKey,
  renderPage,
  resolveMeasurementId,
} from './build.mjs';

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
  assert.throws(() => renderPage('{{GAME_URL}} {{NOPE}}', { gameUrl: 'a', repoUrl: 'b', siteUrl: 'c', controls: '' }), /NOPE/);
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
    assert.ok(
      html.includes(`<meta property="og:image" content="${DEFAULT_SITE_URL}img/spawn.jpg" />`),
      'og:image is absolute, as link-preview crawlers require',
    );
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

test('build honours CS2D_GAME_URL and CS2D_SITE_URL', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cs2d-site-'));
  try {
    // no trailing slash, as actions/configure-pages reports it
    build({ outDir, env: { CS2D_GAME_URL: 'https://play.example.com/', CS2D_SITE_URL: 'https://site.example.com/sub' } });
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.ok(html.includes('href="https://play.example.com/"'));
    assert.ok(html.includes('content="https://site.example.com/sub/img/spawn.jpg"'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('resolveMeasurementId defaults, honours overrides and "off", and rejects junk', () => {
  assert.equal(resolveMeasurementId(undefined), DEFAULT_GA_MEASUREMENT_ID);
  assert.equal(resolveMeasurementId(''), DEFAULT_GA_MEASUREMENT_ID); // unset repo variable
  assert.equal(resolveMeasurementId('G-ABC1234'), 'G-ABC1234');
  assert.equal(resolveMeasurementId('off'), null);
  assert.throws(() => resolveMeasurementId("G-1'); alert(1); //"), /GA4/);
  assert.throws(() => resolveMeasurementId('UA-123-1'), /GA4/);
});

test('build embeds GA with the default ID, tracks Play now clicks and links to the game domain', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cs2d-site-'));
  try {
    const { gaId } = build({ outDir, env: {} });
    assert.equal(gaId, DEFAULT_GA_MEASUREMENT_ID);
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.ok(html.includes(`gtag/js?id=${DEFAULT_GA_MEASUREMENT_ID}`));
    assert.ok(html.includes(`gtag('config', '${DEFAULT_GA_MEASUREMENT_ID}'`));
    assert.ok(html.includes(JSON.stringify(new URL(DEFAULT_GAME_URL).hostname)), 'cross-domain linker');
    assert.ok(html.includes('doNotTrack'), 'honours Do Not Track');
    assert.equal(html.match(/data-cta="/g)?.length, 3, 'every Play link is tagged');
    assert.ok(html.indexOf('gtag/js') < html.indexOf('</head>'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('build honours CS2D_GA_MEASUREMENT_ID, including "off"', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cs2d-site-'));
  try {
    build({ outDir, env: { CS2D_GA_MEASUREMENT_ID: 'G-TEST1234' } });
    assert.ok(readFileSync(join(outDir, 'index.html'), 'utf8').includes('gtag/js?id=G-TEST1234'));
    build({ outDir, env: { CS2D_GA_MEASUREMENT_ID: 'off' } });
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.ok(!html.includes('gtag'), 'no analytics when off');
    assert.ok(!html.includes('{{ANALYTICS}}'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
