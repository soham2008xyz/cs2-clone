import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rawDataToString, resolveStaticFile } from '../src/serverUtils.js';

const ROOT = resolve('/srv/client/dist');

describe('resolveStaticFile', () => {
  it('maps / to index.html', () => {
    expect(resolveStaticFile(ROOT, '/')).toBe(join(ROOT, 'index.html'));
  });

  it('resolves nested asset paths inside the root', () => {
    expect(resolveStaticFile(ROOT, '/assets/app.js')).toBe(join(ROOT, 'assets', 'app.js'));
  });

  it('rejects paths that climb out of the root', () => {
    expect(resolveStaticFile(ROOT, '/../package.json')).toBeNull();
    expect(resolveStaticFile(ROOT, '/assets/../../../etc/passwd')).toBeNull();
  });

  it('rejects sibling directories that share the root as a prefix', () => {
    expect(resolveStaticFile(ROOT, '/../dist-secrets/key.pem')).toBeNull();
  });

  it('treats percent-encoded dots as a literal name, not a parent segment', () => {
    expect(resolveStaticFile(ROOT, '/%2e%2e/package.json')).toBe(join(ROOT, '%2e%2e', 'package.json'));
  });

  it('rejects the root itself', () => {
    expect(resolveStaticFile(ROOT, '/.')).toBeNull();
  });
});

describe('rawDataToString', () => {
  it('decodes a Buffer', () => {
    expect(rawDataToString(Buffer.from('{"t":"ping"}'))).toBe('{"t":"ping"}');
  });

  it('decodes an ArrayBuffer', () => {
    const bytes = new TextEncoder().encode('héllo');
    expect(rawDataToString(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe('héllo');
  });

  it('joins fragmented Buffer[] without separators', () => {
    expect(rawDataToString([Buffer.from('{"t":'), Buffer.from('"ping"}')])).toBe('{"t":"ping"}');
  });
});
