import { describe, expect, it } from 'vitest';
import { BTN, MAX_CHAT_LEN, MAX_NAME_LEN, parseClientMsg, validateClientMsg } from '../src/index.js';

describe('validateClientMsg', () => {
  it('rejects non-objects and unknown types', () => {
    for (const v of [null, undefined, 5, 'x', [], [{ t: 'ping', t0: 1 }], {}, { t: 'nope' }, { t: 5 }]) {
      expect(validateClientMsg(v)).toBeNull();
    }
  });

  describe('join', () => {
    it('accepts a name with and without a team', () => {
      expect(validateClientMsg({ t: 'join', name: 'a' })).toEqual({ t: 'join', name: 'a' });
      expect(validateClientMsg({ t: 'join', name: '', team: 'CT' })).toEqual({ t: 'join', name: '', team: 'CT' });
    });
    it('rejects a missing, non-string or oversized name and a bad team', () => {
      expect(validateClientMsg({ t: 'join' })).toBeNull();
      expect(validateClientMsg({ t: 'join', name: 5 })).toBeNull();
      expect(validateClientMsg({ t: 'join', name: {} })).toBeNull();
      expect(validateClientMsg({ t: 'join', name: 'x'.repeat(MAX_NAME_LEN + 1) })).toBeNull();
      expect(validateClientMsg({ t: 'join', name: 'a', team: 'X' })).toBeNull();
      expect(validateClientMsg({ t: 'join', name: 'a', team: null })).toBeNull();
    });
  });

  describe('input', () => {
    const base = { t: 'i', s: 1, b: BTN.UP | BTN.ATTACK, a: 1.5 };
    it('accepts a full input and strips unknown fields', () => {
      expect(validateClientMsg({ ...base, w: 4, k: 100, extra: 'x' })).toEqual({ ...base, w: 4, k: 100 });
      expect(validateClientMsg(base)).toEqual(base);
    });
    it('rejects non-finite or non-number s, a, k', () => {
      expect(validateClientMsg({ ...base, s: '1' })).toBeNull();
      expect(validateClientMsg({ ...base, s: NaN })).toBeNull();
      expect(validateClientMsg({ ...base, a: undefined })).toBeNull();
      expect(validateClientMsg({ ...base, a: Infinity })).toBeNull();
      expect(validateClientMsg({ ...base, k: 'x' })).toBeNull();
      expect(validateClientMsg({ ...base, k: null })).toBeNull();
    });
    it('rejects a bad button mask', () => {
      expect(validateClientMsg({ ...base, b: '1' })).toBeNull();
      expect(validateClientMsg({ ...base, b: 1.5 })).toBeNull();
      expect(validateClientMsg({ ...base, b: -1 })).toBeNull();
      expect(validateClientMsg({ ...base, b: 1 << 20 })).toBeNull();
    });
    it('rejects a slot outside the integers 1..4', () => {
      for (const w of ['x', 1.5, 0, 5, -1, null]) expect(validateClientMsg({ ...base, w })).toBeNull();
      for (const w of [1, 2, 3, 4]) expect(validateClientMsg({ ...base, w })).toMatchObject({ w });
    });
  });

  describe('buy', () => {
    it('accepts a string item', () => {
      expect(validateClientMsg({ t: 'buy', item: 'ak47' })).toEqual({ t: 'buy', item: 'ak47' });
    });
    it('rejects a missing, non-string or oversized item', () => {
      expect(validateClientMsg({ t: 'buy' })).toBeNull();
      expect(validateClientMsg({ t: 'buy', item: 7 })).toBeNull();
      expect(validateClientMsg({ t: 'buy', item: 'x'.repeat(100) })).toBeNull();
    });
  });

  describe('bots', () => {
    it('accepts optional perTeam and difficulty', () => {
      expect(validateClientMsg({ t: 'bots' })).toEqual({ t: 'bots' });
      expect(validateClientMsg({ t: 'bots', perTeam: 3, difficulty: 'hard' })).toEqual({ t: 'bots', perTeam: 3, difficulty: 'hard' });
    });
    it('rejects a bad perTeam or difficulty', () => {
      expect(validateClientMsg({ t: 'bots', perTeam: '3' })).toBeNull();
      expect(validateClientMsg({ t: 'bots', perTeam: NaN })).toBeNull();
      expect(validateClientMsg({ t: 'bots', difficulty: 'insane' })).toBeNull();
      expect(validateClientMsg({ t: 'bots', difficulty: 1 })).toBeNull();
    });
  });

  describe('team', () => {
    it('accepts T and CT only', () => {
      expect(validateClientMsg({ t: 'team', team: 'T' })).toEqual({ t: 'team', team: 'T' });
      expect(validateClientMsg({ t: 'team', team: 'CT' })).toEqual({ t: 'team', team: 'CT' });
      expect(validateClientMsg({ t: 'team' })).toBeNull();
      expect(validateClientMsg({ t: 'team', team: 'ct' })).toBeNull();
    });
  });

  describe('chat', () => {
    it('accepts a string and rejects other types or oversized text', () => {
      expect(validateClientMsg({ t: 'chat', text: 'hi' })).toEqual({ t: 'chat', text: 'hi' });
      expect(validateClientMsg({ t: 'chat', text: 5 })).toBeNull();
      expect(validateClientMsg({ t: 'chat' })).toBeNull();
      expect(validateClientMsg({ t: 'chat', text: 'x'.repeat(MAX_CHAT_LEN + 1) })).toBeNull();
    });
  });

  describe('ping', () => {
    it('needs a finite t0', () => {
      expect(validateClientMsg({ t: 'ping', t0: 12 })).toEqual({ t: 'ping', t0: 12 });
      expect(validateClientMsg({ t: 'ping' })).toBeNull();
      expect(validateClientMsg({ t: 'ping', t0: '1' })).toBeNull();
      expect(validateClientMsg({ t: 'ping', t0: Infinity })).toBeNull();
    });
  });
});

describe('parseClientMsg', () => {
  it('parses a valid frame', () => {
    expect(parseClientMsg('{"t":"ping","t0":1}')).toEqual({ t: 'ping', t0: 1 });
  });
  it('returns null for bad JSON or a bad shape', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('')).toBeNull();
    expect(parseClientMsg('null')).toBeNull();
    expect(parseClientMsg('{"t":"join"}')).toBeNull();
  });
});
