// WMessage 登录页逻辑（独立于主界面 index.html）
import { setToken, setUser, clearAuth, getUser } from './store.js';
import * as api from './supabase.js';
import { $, el, toast, modal } from './ui.js';

const $app = $('#app');

const state = { user: null, isElectron: false, isMobile: false };

/* ==================== 平台检测与主题 ====================
   桌面客户端 → theme-desktop；手机/PWA → theme-mobile；桌面浏览器 → theme-web */
function detectPlatform() {
  // 桌面壳严格判定：Electron preload 注入，或 WebView2（且来源必须是内置 app.local）
  const isWebView2 = !!(window.chrome && window.chrome.webview) && location.hostname === 'app.local';
  const isElectron = !!(window.desktop && window.desktop.isDesktop) || isWebView2;
  const isMobile = !isElectron && (
    matchMedia('(max-width: 820px)').matches ||
    /Mobi|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  );
  document.documentElement.classList.add(isElectron ? 'theme-desktop' : isMobile ? 'theme-mobile' : 'theme-web');
  state.isMobile = isMobile;
  state.isElectron = isElectron;
}

// 桌面窗口调用：Electron 或 WebView2 桥接；action: close/expand/drag/resize
function desktopCall(action, payload) {
  if (window.desktop && window.desktop.isDesktop) {
    if (action === 'close' && window.desktop.closeWindow) return window.desktop.closeWindow();
    if (action === 'expand' && window.desktop.expandWindow) return window.desktop.expandWindow();
  }
  if (window.chrome && window.chrome.webview) {
    try { window.chrome.webview.postMessage(Object.assign({ action }, payload || {})); } catch { /* 忽略 */ }
  }
}

// 桌面端：上报登录卡片实际尺寸，壳据此贴合窗口（窗口=卡片大小，无留白）
function reportSize() {
  if (!state.isElectron) return;
  let w = document.documentElement.scrollWidth || window.innerWidth;
  let h = document.documentElement.scrollHeight || window.innerHeight;
  const card = document.querySelector('.auth-card');
  if (card) {
    const r = card.getBoundingClientRect();
    if (r.width > 40 && r.height > 40) {
      w = r.width;
      h = r.height;
    }
  }
  desktopCall('resize', { w: Math.ceil(w) + 2, h: Math.ceil(h) + 2 });
}

// 桌面端：窗口标题随界面变化
function setDesktopTitle(text) {
  desktopCall('title', { text });
}

// 桌面端：实时观察卡片尺寸变化（切换登录/注册立即调整，无延迟）
function watchCardResize() {
  if (!state.isElectron) return;
  const card = document.querySelector('.auth-card');
  if (!card || window.__wmsgRo) return;
  try {
    window.__wmsgRo = new ResizeObserver(() => {
      clearTimeout(window.__wmsgRsT);
      window.__wmsgRsT = setTimeout(reportSize, 50);
    });
    window.__wmsgRo.observe(card);
  } catch { /* 老浏览器忽略 */ }
}

/* ==================== 邮箱未验证弹窗（重发 + 60 秒冷却） ==================== */
const RESEND_COOLDOWN = 60 * 1000;
const RESEND_KEY = 'wmessage_resend_at';

function showVerifyModal(email) {
  const cooldownBox = el('div', { style: 'margin-top:10px;font-size:12px;color:var(--muted-2)' });
  const resendBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'margin-top:14px' }, '重发验证邮件');
  const body = el('div', null,
    el('div', { style: 'color:var(--text);line-height:1.8;font-size:14px' },
      '验证邮件已发送至 ', el('b', null, email), '。', el('br'),
      '请到邮箱（含垃圾箱）查看，点击「验证邮箱并登录」完成验证后再来登录。'),
    cooldownBox,
    resendBtn
  );
  const m = modal({ title: '邮箱尚未验证', body, actions: [{ label: '我知道了', onClick: () => {} }] });

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    try {
      await api.resendVerification(email);
      localStorage.setItem(RESEND_KEY, String(Date.now()));
      cooldownBox.textContent = '验证邮件已重新发送，请查收。';
      toast('验证邮件已重新发送');
    } catch (e) {
      cooldownBox.textContent = e.message;
    }
    tick();
  });

  function tick() {
    const last = parseInt(localStorage.getItem(RESEND_KEY) || '0', 10);
    const remain = Math.ceil((last + RESEND_COOLDOWN - Date.now()) / 1000);
    if (remain > 0) {
      resendBtn.disabled = true;
      resendBtn.textContent = `${remain} 秒后可重发`;
      setTimeout(tick, 1000);
    } else {
      resendBtn.disabled = false;
      resendBtn.textContent = '重发验证邮件';
    }
  }
  tick();
}

/* ==================== 登录 / 注册表单 ==================== */
function bindAuth() {
  let mode = 'login';
  const tabs = $app.querySelectorAll('.tab');

  // 按当前模式同步表单：隐藏字段绝不参与浏览器校验（否则提交会被静默拦截）
  function applyMode() {
    const isReg = mode === 'register';
    $('#userField').hidden = !isReg;
    $('#userField input').required = isReg;
    $('#nickField').hidden = !isReg;
    $('#emailLabel').textContent = isReg ? '邮箱' : '账号';
    $('#authEmail').placeholder = isReg ? '注册请使用邮箱（you@example.com）' : '用户名或邮箱';
    $('#authSubmit').textContent = isReg ? '注 册' : '登 录';
    $('#authTip').textContent = isReg ? '已有账号？点击「登录」' : '还没有账号？点击「注册」创建';
    $('#authError').textContent = '';
    setDesktopTitle(isReg ? 'WMessage 注册' : 'WMessage 登录');
    setTimeout(reportSize, 150);
    setTimeout(reportSize, 350);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      applyMode();
    });
  });

  // 初始即为登录模式：显式同步一次，避免隐藏字段带 required 阻断提交
  applyMode();
  watchCardResize();

  // 深链：#register（如邀请邮件）直达注册标签
  if (location.hash === '#register') {
    const reg = $app.querySelector('.tab[data-mode="register"]');
    if (reg) reg.click();
  }

  // 桌面端窗口拖拽（标题栏/空白区域按住拖动）
  document.addEventListener('mousedown', (e) => {
    if (!state.isElectron) return;
    const t = e.target;
    if (t && (t.closest('button, input, textarea, a, label'))) return;
    if (t && (t.closest('.auth'))) {
      e.preventDefault();
      desktopCall('drag');
    }
  });

  // 桌面客户端右上角关闭按钮（无边框窗口）
  if (state.isElectron) {
    const winClose = $('#winClose');
    if (winClose) {
      winClose.hidden = false;
      winClose.addEventListener('click', () => desktopCall('close'));
    }
  }

  // 桌面端：初始布局稳定后上报尺寸（窗口自动贴合登录卡片）
  setTimeout(reportSize, 150);
  setTimeout(reportSize, 400);
  setTimeout(reportSize, 800);

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const nickname = $('#authNickname').value.trim();
    const username = $('#authUsername') ? $('#authUsername').value.trim() : '';
    const btn = $('#authSubmit');
    btn.disabled = true;
    $('#authError').textContent = '';
    try {
      const data = mode === 'login'
        ? await api.login({ account: email, password })
        : await api.register({ username, email, password, nickname });
      if (data.needVerify) {
        // 邮箱验证开启：注册成功但需先确认邮箱
        setToken('');
        $('#authError').textContent = `注册成功！验证邮件已发送至 ${email}，请点击邮件中的链接完成验证后再登录。`;
        return;
      }
      setToken(data.token);
      setUser(data.user);
      state.user = data.user;
      // 进入主界面（index.html 会检测登录态）
      location.href = './index.html';
    } catch (err) {
      // 任何失败都必须在界面上可见：先保证有提示，再尝试更丰富的弹窗
      const msg = (err && (err.message || err.error_description)) || String(err) || '登录失败，请稍后重试';
      $('#authError').textContent = msg;
      if (err && err.code === 'EMAIL_NOT_CONFIRMED') {
        try {
          showVerifyModal(email);
        } catch (e) {
          // 弹窗构建失败也不能吞掉错误：红色提示已显示具体原因
          console.error('验证弹窗打开失败', e);
        }
      }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ==================== 启动 ==================== */
// 兜底：任何未捕获异常都要在界面上可见，避免"点了没反应"
function surfaceError(text) {
  const box = document.getElementById('authError');
  if (box && !box.textContent) box.textContent = text;
  console.error('[WMessage]', text);
}
window.addEventListener('error', (e) => surfaceError((e && e.message) || '页面运行出错'));
window.addEventListener('unhandledrejection', (e) => {
  const r = (e && e.reason) || {};
  surfaceError(r.message || String(r) || '操作未能完成');
});

detectPlatform();
bindAuth();
