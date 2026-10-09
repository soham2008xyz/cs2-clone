// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initChat, teardownChat } from '../src/chat.js';

let sent: string[];
let toggles: boolean[];
let input: HTMLInputElement;

const press = (key: string, target: EventTarget = window) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
};

beforeEach(() => {
  document.body.innerHTML = '<div id="chat-log"></div><input id="chat-input" style="display:none" />';
  input = document.getElementById('chat-input') as HTMLInputElement;
  sent = [];
  toggles = [];
  initChat(
    (t) => sent.push(t),
    (o) => toggles.push(o),
  );
});

describe('chat keyboard handling', () => {
  it('Enter opens the box, focuses it and tells the scene chat is open', () => {
    const ev = press('Enter');
    expect(input.style.display).toBe('block');
    expect(document.activeElement).toBe(input);
    expect(toggles).toEqual([true]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores other keys while closed', () => {
    press('a');
    expect(input.style.display).toBe('none');
    expect(toggles).toEqual([]);
  });

  it('Enter sends the trimmed text, closes the box and swallows the event', () => {
    press('Enter');
    const blur = vi.spyOn(input, 'blur');
    input.value = '  hello team  ';
    const ev = press('Enter');
    expect(sent).toEqual(['hello team']);
    expect(toggles).toEqual([true, false]);
    expect(input.style.display).toBe('none');
    expect(blur).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false); // Enter inside the box is not a game hotkey, but it is stopped (see below)
  });

  it('an empty message closes the box without sending', () => {
    press('Enter');
    input.value = '   ';
    press('Enter');
    expect(sent).toEqual([]);
    expect(toggles).toEqual([true, false]);
  });

  it('Escape cancels without sending', () => {
    press('Enter');
    input.value = 'draft';
    press('Escape');
    expect(sent).toEqual([]);
    expect(toggles).toEqual([true, false]);
  });

  it('keys typed into the box are stopped from propagating to game hotkeys', () => {
    press('Enter');
    const stop = vi.spyOn(Event.prototype, 'stopPropagation');
    press('w');
    expect(stop).toHaveBeenCalled();
    stop.mockRestore();
  });

  it('reopening starts from an empty box', () => {
    press('Enter');
    input.value = 'old';
    press('Escape');
    // jsdom keeps focus on an element hidden via display:none; a real browser drops it
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.body });
    try {
      press('Enter');
      expect(input.value).toBe('');
    } finally {
      delete (document as unknown as Record<string, unknown>).activeElement;
    }
  });

  it('is inert after teardown and re-armed by a new initChat, without double-firing', () => {
    teardownChat();
    press('Enter');
    expect(toggles).toEqual([]);

    initChat(
      (t) => sent.push(t),
      (o) => toggles.push(o),
    );
    press('Enter');
    expect(toggles).toEqual([true]); // exactly once: the window listener is only attached on the first init
  });
});
