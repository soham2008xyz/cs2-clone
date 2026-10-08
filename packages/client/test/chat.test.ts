// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { appendChatLine, initChat, teardownChat } from '../src/chat.js';

function setUpDom(): void {
  document.body.innerHTML = '<div id="chat-log"></div><input id="chat-input" style="display:none" />';
}

describe('appendChatLine', () => {
  beforeEach(() => {
    setUpDom();
    initChat(
      () => {},
      () => {},
    );
  });

  it('renders text via textContent, not innerHTML — no XSS from chat text', () => {
    appendChatLine('Attacker', '<img src=x onerror=alert(1)>', '#fff');
    const log = document.getElementById('chat-log')!;
    expect(log.children).toHaveLength(1);
    expect(log.children[0].textContent).toBe('Attacker: <img src=x onerror=alert(1)>');
    expect(log.innerHTML).not.toContain('<img');
  });

  it('caps the log at 8 lines, dropping the oldest first', () => {
    for (let i = 0; i < 12; i++) appendChatLine('P', `msg ${i}`, '#fff');
    const log = document.getElementById('chat-log')!;
    expect(log.children).toHaveLength(8);
    // oldest 4 (msg 0..3) evicted; the surviving window is msg 4..11
    expect(log.children[0].textContent).toBe('P: msg 4');
    expect(log.children[7].textContent).toBe('P: msg 11');
  });
});

describe('teardownChat', () => {
  beforeEach(() => {
    setUpDom();
  });

  it('clears the log, hides the input and ignores Enter until the next match', () => {
    const sent: string[] = [];
    initChat(
      (t) => sent.push(t),
      () => {},
    );
    appendChatLine('P', 'hello', '#fff');
    teardownChat();

    const log = document.getElementById('chat-log')!;
    const input = document.getElementById('chat-input') as HTMLInputElement;
    expect(log.children).toHaveLength(0);
    expect(input.style.display).toBe('none');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.style.display).toBe('none');
    expect(sent).toEqual([]);

    // a new match re-arms chat
    initChat(
      () => {},
      () => {},
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(input.style.display).toBe('block');
    teardownChat();
  });
});
