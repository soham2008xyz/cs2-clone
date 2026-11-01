// Builds the static landing page into site/dist.
//   node site/build.mjs
// Env overrides:
//   CS2D_GAME_URL  where "Play now" points (default: the live game)
//   CS2D_REPO_URL  where the GitHub links point
//   CS2D_SITE_URL  where this page is hosted; social previews need absolute URLs
// The controls table is generated from the "## Controls" table in README.md so
// the two never drift apart. No dependencies: plain Node only.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GAME_URL = 'https://cs2d.sohambanerjee.me/';
export const DEFAULT_REPO_URL = 'https://github.com/soham2008xyz/cs2-clone';
export const DEFAULT_SITE_URL = 'https://soham2008xyz.github.io/cs2-clone/';

const siteDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(siteDir);

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Rejects anything that isn't an absolute http(s) URL, so a bad env value fails the build. */
export function checkUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be http(s): ${JSON.stringify(value)}`);
  }
  return url.href;
}

/** Returns [key, action] rows from the first markdown table under `## Controls`. */
export function parseControls(readme) {
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Controls\s*$/.test(l));
  if (start === -1) throw new Error('README.md has no "## Controls" section');
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  if (rows.length < 2) throw new Error('README.md "## Controls" table is empty');
  return rows.slice(1).map(([key = '', action = '']) => [key, action]); // drop the header row
}

/** "1 / 2 / 3" → three <kbd>s; a trailing "(hold)" stays plain text. */
export function renderKey(key) {
  const trimmed = key.trim();
  const open = trimmed.endsWith(')') ? trimmed.lastIndexOf('(') : -1;
  const main = open > 0 ? trimmed.slice(0, open).trim() : trimmed;
  const note = open > 0 ? trimmed.slice(open) : '';
  const keys = main
    .split(' / ')
    .map((k) => `<kbd>${escapeHtml(k.trim())}</kbd>`)
    .join(' / ');
  return note ? `${keys} ${escapeHtml(note)}` : keys;
}

export function renderControls(rows) {
  return rows
    .map(([key, action]) => `                <tr><td>${renderKey(key)}</td><td>${escapeHtml(action)}</td></tr>`)
    .join('\n');
}

export function renderPage(template, { gameUrl, repoUrl, siteUrl, controls }) {
  const out = template
    .replaceAll('{{SITE_URL}}', escapeHtml(siteUrl))
    .replaceAll('{{GAME_URL}}', escapeHtml(gameUrl))
    .replaceAll('{{REPO_URL}}', escapeHtml(repoUrl))
    .replaceAll('{{CONTROLS}}', controls);
  const left = /\{\{[A-Z_]+\}\}/.exec(out);
  if (left) throw new Error(`unfilled placeholder ${left[0]} in index.html`);
  return out;
}

export function build({ outDir = join(siteDir, 'dist'), env = process.env } = {}) {
  const gameUrl = checkUrl('CS2D_GAME_URL', env.CS2D_GAME_URL || DEFAULT_GAME_URL);
  const repoUrl = checkUrl('CS2D_REPO_URL', env.CS2D_REPO_URL || DEFAULT_REPO_URL);
  // Base URL for relative paths like img/x.jpg, so it must end in a slash.
  const siteBase = checkUrl('CS2D_SITE_URL', env.CS2D_SITE_URL || DEFAULT_SITE_URL);
  const siteUrl = siteBase.endsWith('/') ? siteBase : `${siteBase}/`;
  const readme = readFileSync(join(rootDir, 'README.md'), 'utf8');
  const template = readFileSync(join(siteDir, 'src', 'index.html'), 'utf8');
  const html = renderPage(template, { gameUrl, repoUrl, siteUrl, controls: renderControls(parseControls(readme)) });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(siteDir, 'src'), outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  // Tell GitHub Pages to serve files as-is instead of running Jekyll.
  writeFileSync(join(outDir, '.nojekyll'), '');
  return { outDir, gameUrl, repoUrl, siteUrl };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, gameUrl } = build();
  console.log(`site built into ${outDir} (Play now → ${gameUrl})`);
}
