import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({ name: 'ReaCut', version: '0.5.0' }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false });
const screen = document.querySelector<HTMLImageElement>('#screen')!;
const status = document.querySelector<HTMLElement>('#status')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const text = document.querySelector<HTMLInputElement>('#text')!;
let stopped = false, connected = false, dragging = false, lastMove = 0;
let queue = Promise.resolve();
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join(' ') || '操作失败');
  return result.structuredContent as Record<string, any>;
}
function input(args: Record<string, unknown>) {
  queue = queue.then(async () => { await call('reacut_input', args); }).catch(e => { status.textContent = String(e.message); });
  return queue;
}
async function poll() {
  if (stopped) return;
  if (!document.hidden) {
    try {
      const frame = await call('reacut_frame');
      if (frame.data) { screen.src = `data:image/jpeg;base64,${frame.data}`; screen.width = frame.width; screen.height = frame.height; }
      status.textContent = '本地连接 · 实时画面';
    } catch (e) { status.textContent = `连接中断 · ${e instanceof Error ? e.message : e}`; }
  }
  if (!stopped) setTimeout(poll, 150);
}
const mods = (e: MouseEvent | KeyboardEvent) => [e.shiftKey && 'shift', e.ctrlKey && 'control', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean);
function point(e: MouseEvent) {
  const r = screen.getBoundingClientRect();
  return { x: Math.max(0, Math.min(screen.naturalWidth - 1, (e.clientX - r.left) * screen.naturalWidth / r.width)), y: Math.max(0, Math.min(screen.naturalHeight - 1, (e.clientY - r.top) * screen.naturalHeight / r.height)) };
}
screen.onpointerdown = e => {
  if (!connected) return;
  e.preventDefault(); screen.focus(); screen.setPointerCapture(e.pointerId); dragging = true;
  void input({ type: 'mouseDown', ...point(e), button: e.button === 2 ? 'right' : 'left', clickCount: Math.min(3, e.detail || 1), modifiers: mods(e) });
};
screen.onpointermove = e => {
  if (!connected || performance.now() - lastMove < 60) return;
  lastMove = performance.now();
  void input({ type: 'mouseMove', ...point(e), modifiers: [...mods(e), ...(dragging ? ['leftButtonDown'] : [])] });
};
screen.onpointerup = e => {
  if (!connected) return;
  dragging = false;
  void input({ type: 'mouseUp', ...point(e), button: e.button === 2 ? 'right' : 'left', modifiers: mods(e) });
};
screen.onpointercancel = e => { dragging = false; void input({ type: 'mouseUp', ...point(e) }); };
screen.oncontextmenu = e => e.preventDefault();
screen.ondragstart = e => e.preventDefault();
screen.addEventListener('wheel', e => {
  if (!connected) return;
  e.preventDefault();
  void input({ type: 'mouseWheel', ...point(e), deltaX: Math.max(-3000, Math.min(3000, -e.deltaX)), deltaY: Math.max(-3000, Math.min(3000, -e.deltaY)), modifiers: mods(e) });
}, { passive: false });
screen.onkeydown = e => {
  if (!connected || e.isComposing) return;
  if (['Meta','Control','Shift','Alt'].includes(e.key)) return;
  e.preventDefault();
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && e.key !== ' ') void input({ type: 'text', text: e.key });
  else {
    const keys: Record<string, string> = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
    void input({ type: 'key', key: keys[e.key] || e.key, modifiers: mods(e) });
  }
};
screen.onpaste = e => { e.preventDefault(); const value = e.clipboardData?.getData('text/plain'); if (value) void input({ type: 'text', text: value }); };
document.querySelector<HTMLFormElement>('#typing')!.onsubmit = e => {
  e.preventDefault(); if (!text.value || !connected) return;
  void input({ type: 'text', text: text.value }).then(() => { text.value = ''; screen.focus(); });
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-menu]')) button.onclick = () => {
  if (connected) void input({ type: 'menu', command: button.dataset.menu });
};
document.querySelector<HTMLButtonElement>('#desktop')!.onclick = () => { if (connected) void input({ type: 'desktop' }); };
document.querySelector<HTMLButtonElement>('#zoom')!.onclick = e => {
  const original = stage.classList.toggle('original');
  (e.currentTarget as HTMLButtonElement).textContent = original ? '适应窗口' : '100%';
};
app.onteardown = async () => { stopped = true; return {}; };
app.ontoolresult = () => {};
void app.connect().then(async () => {
  connected = true;
  try { await app.requestDisplayMode({ mode: 'fullscreen' }); } catch { /* host chooses presentation */ }
  void poll();
}).catch(e => { status.textContent = `无法连接 Codex：${e.message}`; });
