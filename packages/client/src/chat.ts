let logEl: HTMLElement;
let inputEl: HTMLInputElement;
let onSend: ((text: string) => void) | null = null;
let onToggle: ((open: boolean) => void) | null = null;
let listenerAttached = false;

function openChat(): void {
  inputEl.style.display = 'block';
  inputEl.value = '';
  inputEl.focus();
  onToggle?.(true);
}

function closeChat(): void {
  inputEl.style.display = 'none';
  inputEl.blur();
  onToggle?.(false);
}

/**
 * Wires the DOM chat overlay (real HTML input — far more robust than a Phaser
 * text field). Safe to call again on every match start; the window listener
 * is only attached once, callbacks are simply re-pointed at the new scene.
 */
export function initChat(sendCb: (text: string) => void, toggleCb: (open: boolean) => void): void {
  onSend = sendCb;
  onToggle = toggleCb;
  logEl = document.getElementById('chat-log')!;
  inputEl = document.getElementById('chat-input') as HTMLInputElement;
  if (listenerAttached) return;
  listenerAttached = true;

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === inputEl) {
      if (e.key === 'Enter') {
        const text = inputEl.value.trim();
        if (text) onSend?.(text);
        closeChat();
      } else if (e.key === 'Escape') {
        closeChat();
      }
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter') {
      openChat();
      e.preventDefault();
    }
  });
}

export function appendChatLine(from: string, text: string, color: string): void {
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = `${from}: ${text}`;
  logEl.appendChild(line);
  while (logEl.children.length > 8) logEl.removeChild(logEl.firstChild!);
}
