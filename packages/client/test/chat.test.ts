// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { appendChatLine, initChat } from '../src/chat.js';

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
