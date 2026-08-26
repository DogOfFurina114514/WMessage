// DOM / UI 工具函数
export function $(sel, root) {
  return (root || document).querySelector(sel);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function toast(msg, type = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', class: 'toasts' });
    document.body.append(host);
  }
  const t = el('div', { class: 'toast' + (type === 'error' ? ' toast-error' : '') }, msg);
  host.append(t);
  setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => t.remove(), 350);
  }, 3200);
}

export function modal({ title = '', body = null, actions = [], onClose = null }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const card = el('div', { class: 'modal' });
  if (title) card.append(el('div', { class: 'modal-title' }, title));
  const bodyWrap = el('div', { class: 'modal-body' });
  if (body) bodyWrap.append(body);
  card.append(bodyWrap);
  if (actions.length) {
    const bar = el('div', { class: 'modal-actions' });
    for (const a of actions) {
      bar.append(
        el('button', {
          type: 'button',
          class: 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost'),
          onClick: () => {
            if (!a.keepOpen) close();
            if (a.onClick) a.onClick();
          },
        }, a.label)
      );
    }
    card.append(bar);
  }
  overlay.append(card);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  function close() {
    overlay.remove();
    if (onClose) onClose();
  }
  document.body.append(overlay);
  return { overlay, close };
}

export function avatarEl(text, color, size = 36) {
  const ch = Array.from(String(text || '?').trim() || '?')[0].toUpperCase();
  return el('div', {
    class: 'avatar',
    style: `background:${color || '#4f7cff'};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`,
  }, ch);
}

export function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(ts);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function lightbox(src) {
  const ov = el('div', { class: 'lightbox' });
  const img = el('img', { src, alt: '' });
  img.addEventListener('click', (e) => e.stopPropagation());
  ov.append(img);
  ov.addEventListener('click', () => ov.remove());
  document.body.append(ov);
}
