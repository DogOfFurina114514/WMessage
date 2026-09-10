// 常用表情（内置图片资源：由系统 Microsoft 表情字体渲染，保证各端渲染一致）
// 资源目录：./emoji/<码点>.png（多码点用 - 连接，如 2764-fe0f.png）
export const EMOJIS = [
  '😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '😅', '😭', '😡', '🥳', '🤯', '😴', '🤗',
  '👏', '👍', '👎', '🙏', '💪', '🤝', '✌️', '🤞',
  '👊', '🫡', '❤️', '💔', '💯', '🔥', '✨', '🎉',
  '🎊', '🌹', '🍀', '🌈', '☀️', '🌙', '⭐', '💡',
  '📌', '🍺', '☕', '🍰', '🚀', '⚡', '🎵', '🎮',
  '🏀', '⚽', '🐶', '🐱', '🐼', '🦄', '😇', '😈',
  '🤡', '👻', '💀', '🤖', '💬', '📱', '🖥️', '💰',
  '💎', '✅', '❌', '⚠️', '❓', '❗', '🆗', '🆕',
  '🔑', '🔒', '📷', '🎁', '🧧', '🏮', '🎋', '🇨🇳',
  '🐉', '🥇', '🌸', '🍉', '🍜', '🎂', '🎈',
];

// 表情 → 图片文件名（码点十六进制，多码点用 - 连接）
export function emojiFile(ch) {
  return [...ch].map((c) => c.codePointAt(0).toString(16)).join('-') + '.png';
}

// 表情 → 资源地址
export function emojiSrc(ch) {
  return './emoji/' + emojiFile(ch);
}

// 用内置表情图片切分文本：返回 [{text} | {emoji}] 片段数组
const VARIATION = '\uFE0F';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALT = [...EMOJIS]
  .sort((a, b) => b.length - a.length)
  .map((e) => esc(e.replace(new RegExp(VARIATION, 'g'), '')) + VARIATION + '?');
const EMOJI_RE = new RegExp('(' + ALT.join('|') + ')', 'g');

export function splitEmoji(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  let last = 0;
  EMOJI_RE.lastIndex = 0;
  let m;
  while ((m = EMOJI_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    // 统一映射到内置资源：优先带变体选择符的完整形式
    const withVs = [...m[0]].some((c) => c.codePointAt(0) === 0xfe0f);
    let hit = null;
    for (const e of EMOJIS) {
      const base = e.replace(new RegExp(VARIATION, 'g'), '');
      if (base === m[0].replace(new RegExp(VARIATION, 'g'), '')) { hit = e; break; }
    }
    out.push({ emoji: hit || (withVs ? m[0] : m[0] + VARIATION) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
