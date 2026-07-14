import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverUrl } from '../src/net/connection.js';
import { apiBase } from '../src/net/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serverUrl', () => {
  it('vite dev server (:5173) points at the separate game server on :8090', () => {
    vi.stubGlobal('location', { port: '5173', hostname: 'localhost', protocol: 'http:', host: 'localhost:5173' });
    expect(serverUrl('ABCD')).toBe('ws://localhost:8090?room=ABCD');
  });

  it('falls back to "localhost" when hostname is empty', () => {
    vi.stubGlobal('location', { port: '5173', hostname: '', protocol: 'http:', host: '' });
    expect(serverUrl('ABCD')).toBe('ws://localhost:8090?room=ABCD');
  });

  it('production (non-5173 port) uses the same origin, upgrading to wss over https', () => {
    vi.stubGlobal('location', { port: '', hostname: 'cs2d.example', protocol: 'https:', host: 'cs2d.example' });
    expect(serverUrl('ABCD')).toBe('wss://cs2d.example?room=ABCD');
  });

  it('production over plain http uses ws, not wss', () => {
    vi.stubGlobal('location', { port: '', hostname: 'cs2d.example', protocol: 'http:', host: 'cs2d.example' });
    expect(serverUrl('ABCD')).toBe('ws://cs2d.example?room=ABCD');
  });

  it('URL-encodes the room code', () => {
    vi.stubGlobal('location', { port: '5173', hostname: 'localhost', protocol: 'http:', host: 'localhost:5173' });
    expect(serverUrl('a b&c')).toBe('ws://localhost:8090?room=a%20b%26c');
  });
});

describe('apiBase', () => {
  it('vite dev server (:5173) points at the separate game server on :8090', () => {
    vi.stubGlobal('location', { port: '5173', hostname: 'localhost' });
    expect(apiBase()).toBe('http://localhost:8090');
  });

  it('falls back to "localhost" when hostname is empty', () => {
    vi.stubGlobal('location', { port: '5173', hostname: '' });
    expect(apiBase()).toBe('http://localhost:8090');
  });

  it('production (non-5173 port) uses the same origin', () => {
    vi.stubGlobal('location', { port: '', hostname: 'cs2d.example', origin: 'https://cs2d.example' });
    expect(apiBase()).toBe('https://cs2d.example');
  });
});
