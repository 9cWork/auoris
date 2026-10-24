
// ================================================================ WAVE 2 (client-only): command palette, themes + custom CSS, typing indicators,
// do-not-disturb / quiet hours, call screen sharing, "sign out everywhere else".
// Self-contained block: hooks existing globals by wrapping them (applyPrefs, openSettings, openAccount, osNotify, Sfx.play/startLoop,
// actNotify, makePeerConnection, enterActiveCall, endCall, handleCallSignal) and uses event delegation for the chat inputs, so no other
// code in the two big <script> blocks had to change. Settings keys (all in app.py SETTING_KEYS): theme_id, custom_css, typing_share,
// dnd_on, quiet_hours, dnd_calls.
(() => {
'use strict';

// ---------------------------------------------------------------- pure helpers (unit-tested by extraction, keep them dependency-free)
/*@@pure-begin*/
const CSS_MAX = 20480;
// Custom CSS can exfiltrate data through anything that makes the webview fetch a URL (url(), @import, image-set(), ...), and old IE-isms
// can run script. So: comments are stripped first (they could split a keyword), backslash escapes are refused outright (\75rl( == url( to the
// CSS parser), every fetch-capable function is renamed to an unknown function (which makes the whole declaration invalid, parens balanced),
// @import is cut, and the pass repeats until stable so removals can't assemble a new forbidden token. Result is set via textContent only.
function sanitizeCss(input) {
  const removed = [];
  let css = String(input == null ? '' : input), truncated = false;
  if (css.length > CSS_MAX) { css = css.slice(0, CSS_MAX); truncated = true; }
  const note = s => { if (removed.indexOf(s) < 0) removed.push(s); };
  for (let pass = 0; pass < 6; pass++) {
    const before = css;
    css = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
    if (css.indexOf('\\') >= 0) { note('backslash escapes'); css = css.replace(/\\/g, ''); }
    if (css.indexOf('<') >= 0) { note('"<"'); css = css.replace(/</g, ''); }
    css = css.replace(/@import\b[^;{}]*;?/gi, () => { note('@import'); return ''; });
    css = css.replace(/(?:-webkit-|-moz-|-o-)?(url|image-set|cross-fade|image|src|element|paint|expression)\s*\(/gi, (m, fn) => { note(fn.toLowerCase() + '()'); return 'invalid('; });
    css = css.replace(/javascript\s*:/gi, () => { note('javascript:'); return ''; });
    css = css.replace(/vbscript\s*:/gi, () => { note('vbscript:'); return ''; });
    css = css.replace(/-moz-binding\s*:|behavior\s*:/gi, m => { note(m.replace(/\s*:$/, '')); return 'x-removed:'; });
    if (css === before) break;
  }
  return { css, removed, truncated };
}
// Quiet hours: {enabled, start:'22:00', end:'07:00'} in LOCAL time; start > end means it spans midnight; start == end or bad times = never.
function hhmm(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); if (!m) return null; const h = +m[1], n = +m[2]; return h > 23 || n > 59 ? null : h * 60 + n; }
function quietActive(qh, now) {
  if (!qh || !qh.enabled) return false;
  const a = hhmm(qh.start), b = hhmm(qh.end); if (a == null || b == null || a === b) return false;
  const n = now.getHours() * 60 + now.getMinutes();
  return a < b ? (n >= a && n < b) : (n >= a || n < b);
}
function dndActive(pf, now) { return !!(pf && (pf.dnd_on || pf.status_mode === 'dnd')) || quietActive(pf && pf.quiet_hours, now || new Date()); }
function fuzzy(q, s) {   // subsequence match -> { score, pos[] } or null; substring hits outrank scattered ones
  q = String(q).toLowerCase(); const t = String(s).toLowerCase();
  if (!q) return { score: 0, pos: [] };
  const i = t.indexOf(q);
  if (i >= 0) return { score: 1000 - i * 2 - (t.length - q.length) * 0.1 + (i === 0 ? 200 : 0), pos: Array.from({ length: q.length }, (_, k) => i + k) };
  const pos = []; let j = 0, score = 0, prev = -2;
  for (let k = 0; k < t.length && j < q.length; k++) {
    if (t[k] === q[j]) { pos.push(k); score += 10 + (k === prev + 1 ? 15 : 0) + (k === 0 || /[\s\/\-_:]/.test(t[k - 1]) ? 12 : 0); prev = k; j++; }
  }
  return j === q.length ? { score: score - t.length * 0.05, pos } : null;
}
function typingText(n) {
  if (n.length === 1) return n[0] + ' is typing…';
  if (n.length === 2) return n[0] + ' and ' + n[1] + ' are typing…';
  if (n.length === 3) return n[0] + ', ' + n[1] + ' and ' + n[2] + ' are typing…';
  return n[0] + ', ' + n[1] + ' and ' + (n.length - 2) + ' others are typing…';
}
/*@@pure-end*/

const mk = (tag, props, html) => { const e = document.createElement(tag); if (props) Object.assign(e, props); if (html != null) e.innerHTML = html; return e; };
const save = (k, v) => { prefs[k] = v; try { return api().set_setting(k, v); } catch (e) { return null; } };

// ---------------------------------------------------------------- styles for everything in this block
document.head.appendChild(mk('style', { id: 'w2Style' }, `
  #w2Pal { border: 1px solid var(--border2); border-radius: 14px; background: var(--panel); color: var(--text); padding: 0; width: min(560px, 92vw); margin-top: 12vh; box-shadow: 0 30px 80px -20px #000c; }
  #w2Pal::backdrop { background: #0008; }
  #w2Pal input { width: 100%; border: 0; border-bottom: 1px solid var(--border); border-radius: 14px 14px 0 0; background: transparent; padding: 14px 16px; font-size: 15px; outline: none; color: var(--text); }
  #w2PalList { max-height: 50vh; overflow-y: auto; padding: 6px; }
  #w2PalList .pi { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13.5px; }
  #w2PalList .pi.sel { background: var(--accbg); box-shadow: inset 2px 0 0 var(--acc); }
  #w2PalList .pi .g { flex: none; width: 74px; font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
  #w2PalList .pi .l { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #w2PalList .pi .h { flex: none; color: var(--muted); font-size: 12px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #w2PalList mark { background: none; color: var(--acc); font-weight: 700; }
  #w2PalList .none { padding: 14px; color: var(--muted); text-align: center; }
  #w2PalFoot { padding: 6px 12px 8px; font-size: 11px; color: var(--dim); border-top: 1px solid var(--border); }
  #w2Typing { height: 0; overflow: hidden; font-size: 12px; color: var(--muted); padding: 0 14px; font-style: italic; pointer-events: none; }
  #w2Typing.on { height: 20px; line-height: 20px; }
  .sidefoot #w2DndBtn { flex: none; width: auto; font-size: 15px; padding: 6px 8px; opacity: .4; }
  .sidefoot #w2DndBtn.on { opacity: 1; color: var(--warn); }
  #w2Theme .seg { flex-wrap: wrap; max-width: 100%; }
  #w2ThemeSeg { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; background: none !important; padding: 0 !important; border: 0 !important; }
  #w2ThemeSeg button { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); height: auto; }
  #w2ThemeSeg button.on { border-color: var(--acc); box-shadow: 0 0 0 1px var(--acc); }
  #w2ThemeSeg .w2thumb { position: relative; display: block; width: 100%; height: 54px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  #w2ThemeSeg .w2thumb i { position: absolute; left: 0; top: 0; bottom: 0; width: 26%; }
  #w2ThemeSeg .w2thumb b { position: absolute; left: 32%; right: 8%; bottom: 8px; height: 14px; border-radius: 6px; }
  #w2ThemeSeg .w2thumb u { position: absolute; left: 32%; top: 10px; width: 30%; height: 8px; border-radius: 4px; }
  #w2ThemeSeg .w2tn { font-weight: 600; font-size: 13px; color: var(--text); }
  #w2ThemeSeg small { color: var(--muted); font-size: 11px; line-height: 1.3; }
  #w2Theme textarea { width: 100%; min-height: 110px; font: 12px/1.45 ui-monospace, Consolas, monospace; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 8px; resize: vertical; }
  #w2CssWarn { margin-top: 6px; } #w2CssWarn.bad { color: var(--warn); }
  #callShareBtn.on { background: var(--accbg); color: var(--acc); }
`));

// ================================================================ 1. THEMES + CUSTOM CSS
// Presets are :root variable overrides on top of the existing design tokens. Accent-tinted ones also pin --acc* with !important, which beats the
// inline accent swatch (applyPrefs writes those inline); the plain presets leave your accent choice alone.
const XPILL_LIGHT = '.xpill.ok { color: #17713f; } .xpill.mid { color: #8a5600; } .xpill.bad { color: #b02a2a; }';   // the dark pastel pill text is unreadable on light themes
const THEMES = [
  { id: 'default', name: 'Default dark', vars: {} },
  { id: 'midnight', name: 'Midnight', vars: { '--bg': '#04060c', '--side': '#070a12', '--panel': '#0a0e19', '--panel2': '#10162a', '--border': '#171f36', '--border2': '#243052', '--code': '#03050a' } },
  { id: 'aurora', name: 'Aurora', vars: { '--bg': '#08130f', '--side': '#0b1914', '--panel': '#0f211b', '--panel2': '#152d25', '--border': '#1d3a30', '--border2': '#2a5646', '--code': '#06100c' }, acc: ['#6ee7b7', '#34d399', '#0f2e25', '#21634f'] },
  { id: 'light', name: 'Light', scheme: 'light', vars: { '--bg': '#f3f5fa', '--side': '#e9edf5', '--panel': '#ffffff', '--panel2': '#eef1f8', '--border': '#d5dbe8', '--border2': '#b7c1d6', '--text': '#1a2033', '--muted': '#55607a', '--dim': '#8791a8', '--code': '#eceff6', '--accbg': '#dce9ff', '--accline': '#8fb4f5' },
    extra: '.settabs button, .sidefoot button { color: #3a4358; } body { color: #1a2033; } :root { --accbg: #dce9ff !important; --accline: #8fb4f5 !important; } #status { color: #3a4358; } .modelchip { color: #3a4358; } .nfx-gradient { background-image: linear-gradient(90deg, #1f6fd1, #7a4fe0) !important; } .pbadge { background: #dce9ff; border-color: #8fb4f5; color: #1a2033; } #adminSearch { background: #eef1f8; border-color: #d5dbe8; } .sidefoot button, #profBtn { color: #3a4358; } ' + XPILL_LIGHT },
  { id: 'contrast', name: 'High contrast', vars: { '--bg': '#000', '--side': '#000', '--panel': '#0a0a0a', '--panel2': '#161616', '--border': '#8c8c8c', '--border2': '#ffffff', '--text': '#ffffff', '--muted': '#e6e6e6', '--dim': '#c4c4c4', '--code': '#000' }, acc: ['#ffe14d', '#ffd000', '#2a2400', '#ffd000'] },
  { id: 'rose', name: 'Rose', vars: { '--bg': '#170d13', '--side': '#1c1118', '--panel': '#24151d', '--panel2': '#2f1c27', '--border': '#44273a', '--border2': '#63384f' }, acc: ['#ff8fc0', '#ff5fa5', '#331522', '#7a2f55'] },
  { id: 'ocean', name: 'Ocean', vars: { '--bg': '#07141c', '--side': '#0a1a24', '--panel': '#0e2230', '--panel2': '#132c3d', '--border': '#1a3a50', '--border2': '#27577a' }, acc: ['#5fd4ff', '#2bb8f0', '#0d2b3b', '#1f5f80'] },
  { id: 'amber', name: 'Amber', vars: { '--bg': '#160f07', '--side': '#1b130a', '--panel': '#231910', '--panel2': '#2e2114', '--border': '#45321d', '--border2': '#654a2a' }, acc: ['#ffc46b', '#ffa93d', '#33210e', '#7a5224'] },
  { id: 'violet', name: 'Violet', vars: { '--bg': '#100b1c', '--side': '#140f23', '--panel': '#1b142e', '--panel2': '#241b3b', '--border': '#33264f', '--border2': '#4c3a78' }, acc: ['#c4a8ff', '#a17bff', '#221840', '#54429a'] },
  { id: 'slate', name: 'Slate', vars: { '--bg': '#111214', '--side': '#151618', '--panel': '#1b1c1f', '--panel2': '#222327', '--border': '#2c2e33', '--border2': '#3c3f46' } },
  { id: 'frost', name: 'Frost', vars: { '--bg': '#20242c', '--side': '#1b1f26', '--panel': '#262b34', '--panel2': '#2e343f', '--border': '#3a414e', '--border2': '#4c5566', '--text': '#e5e9f0', '--muted': '#a3acbb', '--dim': '#7b8496', '--code': '#1a1d24' } },
  { id: 'forest', name: 'Forest', vars: { '--bg': '#0b130d', '--side': '#0e1811', '--panel': '#132018', '--panel2': '#19291f', '--border': '#22382a', '--border2': '#30503c', '--code': '#081009' }, acc: ['#a3d977', '#86c45a', '#1a2a12', '#3f6a2a'] },
  { id: 'crimson', name: 'Crimson', vars: { '--bg': '#140a0c', '--side': '#190d10', '--panel': '#211116', '--panel2': '#2b161d', '--border': '#3f1f29', '--border2': '#5c2c3b' }, acc: ['#ff7a8a', '#ff5468', '#2e1218', '#7a2a38'] },
  { id: 'sunset', name: 'Sunset', vars: { '--bg': '#140d17', '--side': '#1a111d', '--panel': '#221627', '--panel2': '#2c1c32', '--border': '#3d2745', '--border2': '#573763' }, acc: ['#ffa36b', '#ff8a4c', '#33190f', '#7a4126'] },
  { id: 'sky', name: 'Sky', scheme: 'light', vars: { '--bg': '#eef6fb', '--side': '#e2eef6', '--panel': '#ffffff', '--panel2': '#e9f2f8', '--border': '#cfe0ea', '--border2': '#a9c4d6', '--text': '#13262f', '--muted': '#4a6270', '--dim': '#7f97a5', '--code': '#e6f0f5' },
    extra: 'body { color: var(--text); } :root { --accbg: #d6ecf8 !important; --accline: #7fbfe3 !important; } .settabs button, .sidefoot button, #profBtn, #status, .modelchip { color: var(--text2); } ' +
      '.nfx-gradient { background-image: linear-gradient(90deg, #0b6fa8, #6a4fd0) !important; } .pbadge { background: var(--accbg); border-color: var(--accline); color: var(--text); } ' + XPILL_LIGHT },
  // Full looks (own: true = they style the layout too, so "Classic colours" doesn't replace their palette)
  { id: 'glass', name: 'Glass', own: true, blurb: 'Frosted panels, soft teal glow', vars: { '--bg': '#0a0d16', '--side': '#0d111b', '--panel': '#121724', '--panel2': '#1a2030', '--border': '#232a3c', '--border2': '#33405a', '--code': '#080b13', '--text': '#e8ecf6', '--muted': '#8b93aa', '--dim': '#5f677d' }, acc: ['#3ee0c4', '#2bb8a2', '#0f2e2b', '#1f6a62'],
    extra: '#main { background: radial-gradient(900px 520px at 8% -8%, rgba(62,224,196,.13), transparent 70%), radial-gradient(900px 560px at 100% 108%, rgba(124,108,240,.12), transparent 70%), #0a0d16; } ' +
      '#side { background: rgba(255,255,255,.04) !important; border-right-color: rgba(255,255,255,.07) !important; } ' +   // no backdrop-filter: it would turn these into containing blocks and could mis-place the popups inside them
      '#composer .inner { border-radius: 22px; background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.14); } ' +
      '.msg.user .bubble { background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.10); border-radius: 20px 20px 6px 20px; } ' +
      '.msg.assistant .bubble { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 20px 20px 20px 6px; padding: 14px 18px; } ' +
      '.snav button { border-radius: 14px; } .snav button.on { box-shadow: none; background: rgba(255,255,255,.10); }' },
  { id: 'console', name: 'Console', own: true, blurb: 'Dense, monospace, lime on black', vars: { '--bg': '#0b0c0a', '--side': '#10120e', '--panel': '#10120e', '--panel2': '#161911', '--border': '#2a2d24', '--border2': '#3a3e30', '--code': '#070806', '--text': '#e6ecd9', '--muted': '#9aa38c', '--dim': '#7c8570' }, acc: ['#c8f060', '#a9d640', '#232b0c', '#5c7a1e'],
    extra: 'body, button, input, textarea, select { font-family: "Cascadia Code", Consolas, "Courier New", monospace !important; } ' +
      '.bubble, #composer .inner, .snav button, .modelchip, dialog, .asec { border-radius: 2px !important; } ' +
      '.msg.user .bubble { background: transparent; border: 1px solid var(--border); } #side { background: var(--side) !important; }' },
  { id: 'paper', name: 'Paper', own: true, scheme: 'light', blurb: 'Warm light, serif headings', vars: { '--bg': '#f4f1ea', '--side': '#ebe7dd', '--panel': '#fbfaf6', '--panel2': '#efebe0', '--border': '#d8d2c3', '--border2': '#cfc8b6', '--text': '#26231e', '--muted': '#6a645a', '--dim': '#8a8478', '--code': '#f0ece2' }, acc: ['#b4492d', '#9a3a22', '#f3ddd5', '#d99a86'],
    extra: 'body { color: #26231e; } .settabs button, .sidefoot button, #profBtn, .snav button, .snav kbd { color: #4a443a; } .snav button.on { color: #26231e; } #status, .modelchip { color: #4a443a; } #side { background: var(--side) !important; color: #26231e; } ' +
      'h1, h2, h3, .vhead h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; } .bubble { font-size: 15.5px; line-height: 1.7; } ' +
      '.msg.user .bubble { background: #efebe0; border: 1px solid #d8d2c3; } .pbadge { background: #f3ddd5; border-color: #d99a86; color: #26231e; } .nfx-gradient { background-image: linear-gradient(90deg, #b4492d, #7a4a8c) !important; } ' + XPILL_LIGHT },
  { id: 'hub', name: 'Game hub', own: true, blurb: 'Launcher feel, mint highlights', vars: { '--bg': '#0d0e14', '--side': '#0d0e14', '--panel': '#14161f', '--panel2': '#1b1e2a', '--border': '#20222e', '--border2': '#2c2f3f', '--code': '#090a0f', '--text': '#eef0f7', '--muted': '#9097ad', '--dim': '#6c7289' }, acc: ['#5be3a3', '#3fc98a', '#10261c', '#1f6a47'],
    extra: 'body { font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; } #side { background: var(--side) !important; } ' +
      '.snav button { border-radius: 8px; font-weight: 600; } .snav button.on { background: var(--acc) !important; color: #10131a !important; box-shadow: none; } .snav button.on * { color: #10131a !important; } ' +
      '#composer .inner { border-radius: 12px; } .msg.user .bubble { border-radius: 12px; }' },
];
const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
const LEGACY_PALETTE = ':root { --bg: #262624; --side: #1f1e1d; --panel: #30302e; --panel2: #3a3936; --border: #3d3c39; --border2: #54524d; ' +
  '--text: #f0eee6; --muted: #b0aea5; --dim: #8a887f; --acc: #d97757 !important; --acc2: #c6613f !important; --accbg: #d9775722 !important; --accline: #d9775766 !important; }';
function themeCssText(t) {
  const v = Object.entries(t.vars).map(([k, x]) => `${k}: ${x};`).join(' ');
  const a = t.acc ? ['--acc', '--acc2', '--accbg', '--accline'].map((k, i) => `${k}: ${t.acc[i]} !important;`).join(' ') : '';
  return (v || a || t.scheme ? `:root { ${v} ${a}${t.scheme ? ` color-scheme: ${t.scheme};` : ''} }` : '') + (t.extra ? ' ' + t.extra : '');
}
function applyTheme() {
  const head = document.head;
  let ts = $('themeCss'), us = $('userCss');
  if (!ts) { ts = mk('style', { id: 'themeCss' }); head.appendChild(ts); }
  if (!us) us = mk('style', { id: 'userCss' });
  head.appendChild(us);   // always last, so it wins over the preset
  const legacy = prefs.ui_design === 'legacy';
  document.body.classList.toggle('legacy', legacy);
  const th = themeById(prefs.theme_id);
  // Legacy = the warm neutral palette on any colour theme; Light and High contrast (accessibility choices) keep their own
  ts.textContent = legacy && th.id !== 'light' && th.id !== 'contrast' && !th.own ? LEGACY_PALETTE : themeCssText(th);
  us.textContent = sanitizeCss(prefs.custom_css || '').css;   // re-sanitised on every apply - a hand-edited config.json gets no free pass
}
const _applyPrefs = applyPrefs;
applyPrefs = function () { const r = _applyPrefs.apply(this, arguments); try { applyTheme(); } catch (e) {} try { applyLook(); } catch (e) {} try { applyLayoutModel(); } catch (e) {} return r; };

function themeSettingsInit() {
  const pane = document.querySelector('.setbody [data-pane="appearance"]'); if (!pane || $('w2Theme')) return;
  const box = mk('div', { id: 'w2Theme' }, `<label>Theme</label><div class="seg" id="w2ThemeSeg"></div>
    <label>Advanced: custom CSS</label>
    <div class="vsub" style="margin-bottom:6px">Applied on top of the theme. Anything that could load a remote file or run code (<code>url()</code>, <code>@import</code>, <code>image-set()</code>, <code>expression()</code>, <code>javascript:</code>, <code>&lt;</code>, backslash escapes) is removed. Max 20 KB. Not applied inside plugins.</div>
    <textarea id="w2CssIn" maxlength="${CSS_MAX}" spellcheck="false" placeholder=":root { --r: 6px; }"></textarea>
    <div class="row" style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="w2CssApply" type="button">Apply CSS</button><button class="btn" id="w2ThemeReset" type="button">Reset theme</button></div>
    <div class="vsub" id="w2CssWarn"></div>`);
  pane.appendChild(box);
  $('w2CssApply').onclick = () => {
    const raw = $('w2CssIn').value, w = $('w2CssWarn');
    if (raw.length > CSS_MAX) { w.className = 'vsub bad'; w.textContent = `Too long (${raw.length} characters, limit ${CSS_MAX}). Not applied.`; return; }
    const r = sanitizeCss(raw);
    save('custom_css', r.css.trim() ? r.css : ''); applyTheme();
    $('w2CssIn').value = r.css.trim() ? r.css : '';
    if (r.removed.length) { w.className = 'vsub bad'; w.textContent = 'Removed for safety: ' + r.removed.join(', ') + '. The rest was applied.'; }
    else { w.className = 'vsub'; w.textContent = r.css.trim() ? 'Applied.' : 'Custom CSS cleared.'; }
  };
  $('w2ThemeReset').onclick = () => { save('theme_id', 'default'); save('custom_css', ''); applyTheme(); themeSettingsRefresh(); toast('Theme', 'Reset to the default dark theme.'); };
}
function themeSettingsRefresh() {
  themeSettingsInit(); if (!$('w2Theme')) return;
  const cur = themeById(prefs.theme_id).id, seg = $('w2ThemeSeg');
  const sw = (t, k, d) => (t.vars && t.vars[k]) || d;
  seg.innerHTML = THEMES.map(t => `<button type="button" data-t="${esc(t.id)}" class="${t.id === cur ? 'on' : ''}"><span class="w2thumb" style="background:${sw(t, '--bg', '#0e1119')}"><i style="background:${sw(t, '--side', '#121622')}"></i><b style="background:${sw(t, '--panel', '#161b27')}"></b><u style="background:${t.acc ? t.acc[0] : 'var(--acc)'}"></u></span><span class="w2tn">${esc(t.name)}</span>${t.blurb ? `<small>${esc(t.blurb)}</small>` : ''}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { save('theme_id', b.dataset.t); applyTheme(); themeSettingsRefresh(); });
  $('w2CssIn').value = prefs.custom_css || ''; $('w2CssWarn').className = 'vsub'; $('w2CssWarn').textContent = '';
  const dseg = $('designSeg');
  if (dseg) {
    const cur = prefs.ui_design === 'legacy' ? 'legacy' : 'modern';
    dseg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.d === cur);
      b.onclick = () => { save('ui_design', b.dataset.d); applyTheme(); themeSettingsRefresh(); };
    });
  }
}

// ================================================================ 4. DO NOT DISTURB / QUIET HOURS
const dndNow = () => dndActive(prefs, new Date());
const callsThrough = () => false;   // Do not disturb silences everything, calls included
const _sfxPlay = Sfx.play, _sfxLoop = Sfx.startLoop;
// While DND is on, only call sounds get through: the incoming ring (if "allow calls" is on) and the sounds of a call you're already in.
const sfxAllowed = n => !dndNow() || (n === 'ring' ? callsThrough() : (n === 'ringback' || n === 'connect' || n === 'end') && !!callState);
Sfx.play = function (n, f) { if (sfxAllowed(n)) return _sfxPlay.call(Sfx, n, f); };
Sfx.startLoop = function (n, f) { if (sfxAllowed(n)) return _sfxLoop.call(Sfx, n, f); };
const _osNotify = osNotify;
osNotify = function (title, body) { if (dndNow() && !(callsThrough() && /^Incoming /.test(String(title)))) return; return _osNotify.apply(this, arguments); };
const _actNotify = actNotify;
actNotify = function () { if (dndNow()) return; return _actNotify.apply(this, arguments); };

function dndPaint() { try { statusPaint(); } catch (e) {} }
function dndToggle() {
  if (!dndNow()) return statusSet('dnd');
  if (prefs.status_mode === 'dnd' || prefs.dnd_on) return statusSet('online');
  toast('Quiet hours', 'Do not disturb is on because of your quiet hours. Change them in Settings.');
}
COMMANDS.push({ cmd: '/dnd', desc: 'Toggle Do not disturb', run: () => dndToggle() });

// ---- status: Online / Idle / Do not disturb / Offline (+ a custom line), picked in the profile menu and shown to friends.
// Online turns into Idle by itself after 5 minutes without touching the app; Do not disturb also silences notifications and sounds.
let lastActive = Date.now();
const IDLE_MS = 5 * 60e3, isIdleNow = () => Date.now() - lastActive > IDLE_MS;
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => {
  const was = isIdleNow(); lastActive = Date.now();
  if (was && (prefs.status_mode || 'online') === 'online') { statusPaint(); try { trackLobby(); } catch (e) {} }
}, { passive: true, capture: true }));
function myStatus() {
  const m = prefs.status_mode || 'online';
  if (m === 'offline') return 'offline';
  if (m === 'dnd' || dndNow()) return 'dnd';
  return m === 'idle' || isIdleNow() ? 'idle' : 'online';
}
function statusPaint() {
  const a = $('profDot'); if (!a) return;
  a.style.setProperty('--sc', me ? STATUS_INFO[myStatus()][1] : 'transparent');
  document.querySelectorAll('.pcard .pdot').forEach(d => d.style.setProperty('--sc', me ? STATUS_INFO[myStatus()][1] : 'transparent'));   // the same dot on the profile card
}
function statusSet(mode) {
  save('status_mode', mode);
  if (mode !== 'dnd') save('dnd_on', false);
  statusPaint(); try { trackLobby(); } catch (e) {}
  toast('Status', mode === 'dnd' ? 'Do not disturb - notifications and sounds are silenced.' : mode === 'offline' ? 'You appear offline to your friends.' : 'You are ' + STATUS_INFO[mode][0].toLowerCase() + '.');
}
async function statusAction(a) {
  if (a !== 'text') return statusSet(a);
  const ok = await ask({ title: 'Custom status', ok: 'Save', icon: '✎', html: '<input id="stTxt" type="text" maxlength="80" placeholder="What are you up to? (empty clears it)" style="width:100%">' });
  if (!ok) return;
  save('status_text', ($('stTxt').value || '').trim().slice(0, 80));
  statusPaint(); try { trackLobby(); } catch (e) {}
}
setInterval(() => { statusPaint(); }, 30000);
Object.assign(window, { myStatus, statusPaint, statusSet, statusAction });   // this part of the page runs in a block: the profile menu and presence code call these from outside it

function dndSettingsInit() {
  if ($('w2Dnd')) return; const anchor = $('notifGroupsIn') && $('notifGroupsIn').closest('.setrow'); if (!anchor) return;
  const box = mk('div', { id: 'w2Dnd' }, `
    <div class="setrow"><label class="chk"><input type="checkbox" id="w2QhOn"> <span><span>Quiet hours</span><small>Sets your status to Do not disturb automatically (set it yourself from your profile menu), every day, in your local time (overnight ranges work).</small></span></label>
      <div style="margin:6px 0 0 26px;display:flex;gap:8px;align-items:center">From <input type="time" id="w2QhStart"> to <input type="time" id="w2QhEnd"></div></div>`);
  anchor.after(box);
  const saveQh = () => { save('quiet_hours', { enabled: $('w2QhOn').checked, start: $('w2QhStart').value || '22:00', end: $('w2QhEnd').value || '07:00' }); dndPaint(); };
  $('w2QhOn').onchange = $('w2QhStart').onchange = $('w2QhEnd').onchange = saveQh;
}
function dndSettingsRefresh() {
  dndSettingsInit(); if (!$('w2Dnd')) return;
  const q = prefs.quiet_hours || {};
  $('w2QhOn').checked = !!q.enabled; $('w2QhStart').value = q.start || '22:00'; $('w2QhEnd').value = q.end || '07:00';
}

// ================================================================ 3. TYPING INDICATORS (Realtime broadcast)
// One lightweight broadcast channel per open conversation ('typing:dm:<a>:<b>' / 'typing:gr:<gid>' / 'typing:ch:<cid>'), joined when that
// conversation is on screen and removed when it isn't. Payload is only { u: my user id, c: conversation key } - never any message text.
// Honest limitation: public Realtime broadcast channels are not access-controlled, so the topic is obscurity, not security (the ids are UUIDs
// but not secret from members). We therefore only ever *show* a name for someone who is a known member of the open conversation, and never for
// blocked/muted users; someone outside who learned the id could still observe who is typing (user ids + timing) or spoof a member's event.
// Private channels + RLS on realtime.messages would close this, but that needs a schema change (out of scope this wave).
const TY = { key: null, ch: null, ready: false, last: 0, sent: false, who: new Map() };
function tyKey() {
  if (!sb || !me) return null;
  if ($('chatDlg') && $('chatDlg').open && activeChat) return 'dm:' + [me.id, activeChat].sort().join(':');
  if (view !== 'messages') return null;
  if ($('grChatInput') && grCache && grCache.gid) return 'gr:' + grCache.gid;
  if ($('svChatInput') && svCache && svCache.cid) return 'ch:' + svCache.cid;
  return null;
}
function tyIsMember(k, u) {
  if (!k) return false;
  if (k.startsWith('dm:')) return u === activeChat;
  if (k.startsWith('gr:')) return !!(grCache && grCache.profiles && grCache.profiles.has(u));
  return !!(svCache && svCache.profiles && svCache.profiles.has(u));
}
function tyName(u) {
  if (TY.key && TY.key.startsWith('dm:')) return dmNameOf(u);
  const m = TY.key && TY.key.startsWith('gr:') ? (grCache && grCache.profiles) : (svCache && svCache.profiles), p = m && m.get(u);
  return p ? (p.display_name || p.username) : 'Someone';
}
function tyJoin(k) {
  TY.key = k; TY.who.clear(); TY.ready = false; TY.sent = false; TY.last = 0;
  const ch = sb.channel('typing:' + k, { config: { broadcast: { self: false }, private: true } });
  ch.on('broadcast', { event: 'typing' }, ({ payload }) => tyRecv(k, payload, true));
  ch.on('broadcast', { event: 'typing-stop' }, ({ payload }) => tyRecv(k, payload, false));
  ch.subscribe(st => { if (TY.ch === ch && st === 'SUBSCRIBED') TY.ready = true; });
  TY.ch = ch;
}
function tyLeave() {
  tyStop();
  if (TY.ch) { try { sb.removeChannel(TY.ch); } catch (e) {} }
  TY.ch = null; TY.key = null; TY.ready = false; TY.who.clear();
  const el = $('w2Typing'); if (el) { el.textContent = ''; el.classList.remove('on'); }
}
function tyRecv(k, p, on) {
  if (k !== TY.key || !p || p.c !== k || typeof p.u !== 'string' || p.u === me.id || isQuietUser(p.u) || !tyIsMember(k, p.u)) return;
  if (on) TY.who.set(p.u, Date.now() + 5000); else TY.who.delete(p.u);
  tyRender();
}
function tySendTyping() {
  if (prefs.typing_share === false || !TY.ch || !TY.ready) return;
  const now = Date.now(); if (now - TY.last < 3000) return;
  TY.last = now; TY.sent = true;
  TY.ch.send({ type: 'broadcast', event: 'typing', payload: { u: me.id, c: TY.key } });
}
function tyStop() {
  const was = TY.sent; TY.sent = false; TY.last = 0;
  if (was && TY.ch && TY.ready) TY.ch.send({ type: 'broadcast', event: 'typing-stop', payload: { u: me.id, c: TY.key } });
}
function tyRender() {
  const now = Date.now();
  for (const [u, t] of TY.who) if (t < now || isQuietUser(u) || !tyIsMember(TY.key, u)) TY.who.delete(u);
  const el = $('w2Typing'); if (!el) return;
  const names = [...TY.who.keys()].map(tyName);
  el.textContent = names.length ? typingText(names) : ''; el.classList.toggle('on', names.length > 0);
}
function tyEnsureInd() {
  if (!TY.key) return;
  const form = $(TY.key.startsWith('dm:') ? 'chatForm' : TY.key.startsWith('gr:') ? 'grChatForm' : 'svChatForm'); if (!form || !form.parentNode) return;
  let el = $('w2Typing'); if (!el) el = mk('div', { id: 'w2Typing' });
  if (el.nextSibling !== form) form.parentNode.insertBefore(el, form);
}
function tySync() {
  const k = tyKey();
  if (k !== TY.key) { tyLeave(); if (k) tyJoin(k); }
  tyEnsureInd(); tyRender();
}
setInterval(() => { try { tySync(); } catch (e) {} }, 700);
document.addEventListener('input', e => {
  const id = e.target && e.target.id; if (id !== 'chatInput' && id !== 'svChatInput' && id !== 'grChatInput') return;
  tySync();
  if (e.target.value.trim()) tySendTyping(); else tyStop();
});
document.addEventListener('submit', e => { const id = e.target && e.target.id; if (id === 'chatForm' || id === 'svChatForm' || id === 'grChatForm') tyStop(); }, true);

function typingSettingsInit() {
  const pane = document.querySelector('.setbody [data-pane="privacy"]'); if (!pane || $('w2TypingIn')) return;
  const row = mk('div', { className: 'setrow' }, `<label class="chk"><input type="checkbox" id="w2TypingIn"> <span><span>Share typing status</span><small>Lets people in a DM, group chat or channel see "… is typing". Turn off to type invisibly (you still see others).</small></span></label>`);
  pane.insertBefore(row, pane.firstChild);
  $('w2TypingIn').onchange = e => { save('typing_share', e.target.checked); if (!e.target.checked) tyStop(); };
}
function typingSettingsRefresh() { typingSettingsInit(); if ($('w2TypingIn')) $('w2TypingIn').checked = prefs.typing_share !== false; }

// ---- settings tab hooks (one wrapper for all the settings additions)
const _openSettings = openSettings;
// ================================================================ welcome tour (first launch; "Take the tour" in the profile menu)
const TOUR_STEPS = [
  { ic: '🌙', t: 'Welcome to Auoris', b: 'An AI agent that lives on your PC, plus friends, chats and Minecraft in one place. This takes 30 seconds.', hl: null },
  { ic: '💬', t: 'Chat or Code', b: 'Chat is for talking things through. Code lets the AI read your files, run commands and build things (you approve what it does).', hl: '#modeSeg' },
  { ic: '🧠', t: 'Pick your model', b: 'Run a free local model with Ollama, or add your own cloud key. Explore in the sidebar finds and downloads new models.', hl: '#modelChip' },
  { ic: '💻', t: 'A model for your PC', b: '', hw: true, hl: '#modelChip' },
  { ic: '✦', t: 'Effort and Vibing', b: 'Effort sets how hard the model works. Cloud models show their own levels (ChatGPT has Minimal to High, for example). Vibing is the top level: it always thinks, at the highest setting, with the most steps and a careful step-by-step method.', hl: '#effortSel' },
  { ic: '🧩', t: 'Several AIs, one answer', b: '/extra asks several models at once: they cross-check each other and you get one verified answer, with how much they agreed. Try /extra fast, deep, code or private, and add an effort such as /extra vibing. Pick who joins in the /extra window.', hl: '#input' },
  { ic: '🪓', t: 'Divide the work', b: '/divide hands one task to three models: one plans it, one works out the strategy, one does the work with tools. Set them once with /dividemodels sonnet, fable, opus - and give each its own effort, like sonnet:high, fable:vibing, opus:max.', hl: '#input' },
  { ic: '🤝', t: 'Teams, splits and debates', b: '/team has one model plan and review while yours does the work until it is approved. /split breaks a big request into parts that run at the same time. /debate has two models argue and yours judges. /usage shows what cloud models cost.', hl: '#input' },
  { ic: '🤖', t: 'Your own @agents', b: '/agents saves a model with its own instructions and memory, so you can @mention it in chat or share it with a code. /agent <task> runs a job in the background in its own chat. In Code mode the AI can also start its own sub-agents for big jobs and combine their reports: /agents 8 lets it run up to 8 at once (more agents use more cloud usage).', hl: '#input' },
  { ic: '📋', t: 'Background tasks', b: 'The Tasks button at the top opens a panel beside the chat with agents, routines and multi-model runs while they work. Stop one or open its chat, and see what finished recently.', hl: '#tasksBtn' },
  { ic: '⛏', t: 'Minecraft built in', b: 'Launch Minecraft from here with Fabric + Sodium or OptiFine, and pick capes, wings, hats and pets that other Auoris players can see.', hl: '#navMinecraft' },
  { ic: '👥', t: 'Friends and messages', b: 'The Social tab has DMs, group chats and servers, plus what your friends are playing. It works on auoris.org and your phone too.', hl: '.navtabs' },
  { ic: '🎨', t: 'Make it yours', b: 'Settings has a Modern / Legacy design switch, themes and text size. Take this tour again any time from your profile menu.', hl: '#profBtn' },
];
let tourStep = 0, tourEl = null, tourHw = 'Bigger models are smarter but need more memory. Explore in the sidebar shows what fits.';
function tourEsc(e) { if (e.key === 'Escape') tourClose(true); }
function tourClear() { document.querySelectorAll('.tour-hl').forEach(e => e.classList.remove('tour-hl')); }
function tourClose(done) { tourClear(); if (tourEl) { tourEl.remove(); tourEl = null; } document.removeEventListener('keydown', tourEsc); if (done && !prefs.tour_done) { prefs.tour_done = true; api().set_setting('tour_done', true); } }
function tourRender() {
  const s = Object.assign({}, TOUR_STEPS[tourStep]); if (s.hw) s.b = tourHw; const last = tourStep === TOUR_STEPS.length - 1;
  tourClear();
  const target = s.hl ? document.querySelector(s.hl) : null;
  if (target && target.offsetParent !== null) target.classList.add('tour-hl');
  tourEl.innerHTML = `<div class="tourcard"><div class="tic">${s.ic}</div><h3>${esc(s.t)}</h3><p>${esc(s.b)}</p>
    <div class="tourdots">${TOUR_STEPS.map((_, i) => `<i class="${i === tourStep ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tourbtns"><button class="skip" id="tourSkip">${last ? '' : 'Skip tour'}</button><span style="display:flex;gap:8px">
    ${tourStep > 0 ? '<button class="btn" id="tourBack">Back</button>' : ''}<button class="btn primary" id="tourNext">${last ? 'Done' : 'Next'}</button></span></div></div>`;
  $('tourNext').onclick = () => { if (last) tourClose(true); else { tourStep++; tourRender(); } };
  if ($('tourBack')) $('tourBack').onclick = () => { tourStep--; tourRender(); };
  if ($('tourSkip')) $('tourSkip').onclick = () => tourClose(true);
}
function startTour() {
  if (tourEl) return;
  showView('chat');
  tourEl = document.createElement('div'); tourEl.id = 'tourBox'; document.body.appendChild(tourEl);
  document.addEventListener('keydown', tourEsc);
  tourStep = 0; tourRender();
  try { api().hw_info().then(h => { if (h && h.ram_gb) { const g = h.ram_gb, v = h.vram_gb; tourHw = `Your PC has ${g} GB of memory${v ? ' and ' + v + ' GB of graphics memory' : ''}. ` + ((v || g * 0.5) >= 24 ? 'Large models (30B+) can run well here.' : (v || g * 0.5) >= 12 ? 'A 14B model is a good fit; 8B ones will feel fast.' : (v || g * 0.5) >= 6 ? 'Pick a 7-8B model such as qwen2.5-coder:7b for a good balance.' : 'Stick to small 1-4B models, or use a cloud model with your own key.'); if (tourEl && TOUR_STEPS[tourStep].hw) tourRender(); } }).catch(() => {}); } catch (e) {}
}
async function tourMaybeStart() {   // first launch only, once the sign-in screen is out of the way
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 800));
    if (!prefs || prefs.tour_done === undefined) continue;
    if (prefs.tour_done) return;
    if ($('auth') && !$('auth').hidden) continue;
    startTour(); return;
  }
}

// ================================================================ crash reports (opt-in)
window.addEventListener('error', e => { try { api().log_js_error(String(e.message || 'error'), String((e.error && e.error.stack) || (e.filename + ':' + e.lineno))); } catch (x) {} });
window.addEventListener('unhandledrejection', e => { try { const r = e.reason; api().log_js_error('Unhandled promise rejection: ' + String((r && r.message) || r), String((r && r.stack) || '')); } catch (x) {} });
async function crashFlush() {   // sends stored reports once the user has switched sending on; each is deleted after it is accepted
  if (!prefs.crash_reports || !sb || !me) return;
  try {
    const rs = await api().crash_pending(), ok = [];
    for (const r of rs) {
      const { error } = await sb.from('crash_reports').insert({ user_id: me.id, app_version: r.app_version, os: r.os, kind: r.kind, message: r.message, stack: r.stack });
      if (error && !(error.code && /^(22|23|42)/.test(String(error.code)))) break;   // only permanent rejections (constraint / policy) are dropped; anything else is retried later
      ok.push(r.id);
    }
    if (ok.length) await api().crash_clear(ok);
  } catch (e) {}
}
function lazySettingsRefresh() { const c = $('lazyIn'); if (!c) return; c.checked = prefs.lazy_model_load !== false; c.onchange = () => { prefs.lazy_model_load = c.checked; api().set_setting('lazy_model_load', c.checked); toast('Model loading', c.checked ? 'The AI loads when you send a message.' : 'The AI loads at start-up from the next launch.'); }; }
async function cliSettingsRefresh() {
  const row = $('cliRow'); if (!row) return;
  let st = null; try { st = await api().cli_status(); } catch (e) {}
  if (!st || !st.installed) { row.hidden = true; return; }
  row.hidden = false; $('cliIn').checked = !!st.on;
  $('cliIn').onchange = async () => { const r = await api().cli_toggle($('cliIn').checked); if (r && r.error) { toast('Terminal command', r.error); $('cliIn').checked = !$('cliIn').checked; } else toast('Terminal command', $('cliIn').checked ? 'Added. Open a new terminal and type: auoris --help' : 'Removed'); };
}
async function crashSettingsRefresh() {
  const c = $('crashIn'); if (!c) return;
  c.checked = !!prefs.crash_reports;
  c.onchange = () => { prefs.crash_reports = c.checked; api().set_setting('crash_reports', c.checked); if (c.checked) crashFlush(); };
  try { const n = await api().crash_count(); $('crashInfo').textContent = n ? n + ' report' + (n === 1 ? '' : 's') + ' stored on this PC' : 'No reports stored'; } catch (e) {}
  $('crashOpen').onclick = () => api().crash_open_folder();
}
// ================================================================ find in chat (Ctrl+F)
(function () {
  let bar = null, hits = [], cur = -1;
  function clearMarks() { try { CSS.highlights.delete('find-all'); CSS.highlights.delete('find-cur'); } catch (e) {} hits = []; cur = -1; }
  function scan() {
    clearMarks();
    const q = $('findIn').value.trim().toLowerCase(), root = $('log');
    if (q && root && window.Highlight && CSS.highlights) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('script,style,.nofind') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.toLowerCase(); let i = 0;
        while ((i = t.indexOf(q, i)) >= 0 && hits.length < 2000) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); hits.push(r); i += q.length; }
      }
      if (hits.length) CSS.highlights.set('find-all', new Highlight(...hits));
    }
    if (hits.length) go(0); else $('findCount').textContent = q ? '0 / 0' : '';
  }
  function go(i) {
    if (!hits.length) return;
    cur = (i + hits.length) % hits.length;
    try { CSS.highlights.set('find-cur', new Highlight(hits[cur])); } catch (e) {}
    const el = hits[cur].startContainer.parentElement; if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('findCount').textContent = (cur + 1) + ' / ' + hits.length;
  }
  function close() { if (!bar) return; bar.hidden = true; clearMarks(); }
  function open() {
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'findBar'; bar.hidden = true;
      bar.innerHTML = '<input id="findIn" placeholder="Find in this chat" spellcheck="false"><span class="fcount" id="findCount"></span><button id="findPrev" title="Previous (Shift+Enter)">↑</button><button id="findNext" title="Next (Enter)">↓</button><button id="findX" title="Close (Esc)">✕</button>';
      document.body.appendChild(bar);
      $('findIn').oninput = scan;
      $('findIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); } else if (e.key === 'Escape') { e.preventDefault(); close(); } };
      $('findNext').onclick = () => go(cur + 1); $('findPrev').onclick = () => go(cur - 1); $('findX').onclick = close;
    }
    bar.hidden = false; $('findIn').focus(); $('findIn').select(); scan();
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      if (typeof view !== 'undefined' && view !== 'chat') return;
      e.preventDefault(); open();
    } else if (e.key === 'Escape' && bar && !bar.hidden && !document.querySelector('dialog[open]')) close();
  });
})();


// ================================================================ layout models
// A "model" is a layout + shape preset: where the sidebar sits, how buttons are shaped, density, chat width. Nine are built in;
// your own are JSON (Settings > Appearance > Layout model > Add a model) and are checked field by field before they are used.
const MODEL_SIDES = ['left', 'right', 'rail', 'floating', 'hidden'], MODEL_BTNS = ['round', 'pill', 'square', 'soft'], MODEL_DENS = ['compact', 'cozy', 'roomy'], MODEL_COMP = ['docked', 'floating'];
const DEFAULT_MODELS = [
  { id: 'classic', name: 'Classic', description: 'The standard Auoris layout.', sidebar: 'left', buttons: 'round', radius: 10, density: 'cozy', composer: 'docked', chatWidth: 820 },
  { id: 'mirror', name: 'Mirror', description: 'Sidebar on the right.', sidebar: 'right', buttons: 'round', radius: 10, density: 'cozy', composer: 'docked', chatWidth: 820 },
  { id: 'rail', name: 'Rail', description: 'A slim icon rail on the left.', sidebar: 'rail', buttons: 'round', radius: 10, density: 'compact', composer: 'docked', chatWidth: 900 },
  { id: 'float', name: 'Float', description: 'Sidebar as a floating card, pill composer.', sidebar: 'floating', buttons: 'soft', radius: 16, density: 'cozy', composer: 'floating', chatWidth: 820 },
  { id: 'sharp', name: 'Sharp', description: 'Square corners, tight spacing.', sidebar: 'left', buttons: 'square', radius: 2, density: 'compact', composer: 'docked', chatWidth: 900 },
  { id: 'pill', name: 'Pill', description: 'Round pill buttons, roomy.', sidebar: 'left', buttons: 'pill', radius: 20, density: 'roomy', composer: 'floating', chatWidth: 780 },
  { id: 'focus', name: 'Focus', description: 'No sidebar (Ctrl+B brings it back), narrow column.', sidebar: 'hidden', buttons: 'soft', radius: 14, density: 'roomy', composer: 'floating', chatWidth: 700 },
  { id: 'studio', name: 'Studio', description: 'Sidebar on the right, square corners, wide workspace.', sidebar: 'right', buttons: 'square', radius: 6, density: 'compact', composer: 'docked', chatWidth: 1120, sidebarWidth: 232 },
  { id: 'soft', name: 'Soft', description: 'Big rounded corners and a wider sidebar.', sidebar: 'left', buttons: 'soft', radius: 26, density: 'roomy', composer: 'docked', chatWidth: 800, sidebarWidth: 300 },
  { id: 'widescreen', name: 'Wide', description: 'The chat uses the whole window: long code and tables fit.', sidebar: 'left', buttons: 'round', radius: 8, density: 'compact', composer: 'docked', chatWidth: 1400, sidebarWidth: 232 },
  { id: 'dock', name: 'Dock', description: 'Icon rail and a floating pill message box.', sidebar: 'rail', buttons: 'pill', radius: 18, density: 'cozy', composer: 'floating', chatWidth: 860 },
  { id: 'cards', name: 'Cards', description: 'Everything as soft floating cards, roomy.', sidebar: 'floating', buttons: 'soft', radius: 22, density: 'roomy', composer: 'floating', chatWidth: 760, sidebarWidth: 280 }
];
// Validates a model object (from JSON). Returns { model } or { error }. Unknown fields are dropped; numbers are clamped.
function modelClean(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'A model is a JSON object, like {"id": "mine", "name": "Mine", "sidebar": "right"}.' };
  const pick = (v, list, def) => (list.includes(v) ? v : def), num = (v, lo, hi, def) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : def);
  const id = String(o.id || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,24}$/.test(id)) return { error: '"id" must be 1-24 letters, numbers, - or _.' };
  if (DEFAULT_MODELS.some(m => m.id === id)) return { error: '"' + id + '" is a built-in model id. Pick another id.' };
  for (const [k, list] of [['sidebar', MODEL_SIDES], ['buttons', MODEL_BTNS], ['density', MODEL_DENS], ['composer', MODEL_COMP]]) {
    if (o[k] !== undefined && !list.includes(o[k])) return { error: '"' + k + '" must be one of: ' + list.join(', ') + '.' };
  }
  const m = { id, name: String(o.name || id).slice(0, 30), description: String(o.description || '').slice(0, 120),
    sidebar: pick(o.sidebar, MODEL_SIDES, 'left'), buttons: pick(o.buttons, MODEL_BTNS, 'round'), density: pick(o.density, MODEL_DENS, 'cozy'),
    composer: pick(o.composer, MODEL_COMP, 'docked'), radius: num(o.radius, 0, 32, 10), chatWidth: num(o.chatWidth, 600, 1400, 820) };
  if (o.sidebarWidth !== undefined) m.sidebarWidth = num(o.sidebarWidth, 200, 340, 264);
  if (typeof o.css === 'string' && o.css.trim()) m.css = o.css.slice(0, 8000);
  return { model: m };
}
const allModels = () => DEFAULT_MODELS.concat((Array.isArray(prefs.layout_models) ? prefs.layout_models : []).map(x => (modelClean(x) || {}).model).filter(Boolean));
let _mdlLast = null;
function applyLayoutModel() {
  const m = allModels().find(x => x.id === prefs.layout_model) || DEFAULT_MODELS[0], b = document.body, r = document.documentElement.style;
  const classic = m.id === 'classic';
  for (const [attr, v] of [['data-m-side', m.sidebar], ['data-m-btn', m.buttons], ['data-m-comp', m.composer]]) { if (classic || v === 'left' || v === 'round' || v === 'docked') b.removeAttribute(attr); else b.setAttribute(attr, v); }
  if (_mdlLast !== m.id) b.classList.remove('rail-open');
  if (_mdlLast !== m.id) {   // only when the model actually changes, so Ctrl+B still works afterwards
    if (m.sidebar === 'hidden') b.classList.add('noside'); else if (b.dataset.mHid) b.classList.remove('noside');
    if (m.sidebar === 'hidden') b.dataset.mHid = '1'; else delete b.dataset.mHid;
    _mdlLast = m.id;
  }
  if (m.sidebarWidth && (m.sidebar === 'left' || m.sidebar === 'right' || m.sidebar === 'floating')) { b.setAttribute('data-m-sw', ''); r.setProperty('--m-sw', m.sidebarWidth + 'px'); } else { b.removeAttribute('data-m-sw'); r.removeProperty('--m-sw'); }
  if (classic) { for (const k of ['--r-sm', '--r', '--r-lg', '--r-xl']) r.removeProperty(k); }
  else { r.setProperty('--r-sm', Math.round(m.radius * .8) + 'px'); r.setProperty('--r', m.radius + 'px'); r.setProperty('--r-lg', Math.round(m.radius * 1.4) + 'px'); r.setProperty('--r-xl', Math.round(m.radius * 1.8) + 'px'); }
  b.classList.toggle('roomy', !classic && m.density === 'roomy');
  if (!classic) { b.classList.toggle('dense', m.density === 'compact'); r.setProperty('--chatw', m.chatWidth + 'px'); }
  else { try { applyLook(); } catch (e) {} }   // back to your own density and chat width
  let st = $('modelCss'); if (!st) { st = document.createElement('style'); st.id = 'modelCss'; document.head.appendChild(st); }
  st.textContent = m.css ? sanitizeCss(m.css).css : '';
}
function modelPreview(m) {
  const side = m.sidebar === 'hidden' ? '' : `<i style="width:${m.sidebar === 'rail' ? 7 : Math.round((m.sidebarWidth || 264) / 9)}px;${m.sidebar === 'floating' ? 'margin:1px 0;border-radius:6px;' : ''}"></i>`;
  const right = m.sidebar === 'right';
  return `<div class="mdlprev" style="${right ? 'flex-direction:row-reverse;' : ''}border-radius:${Math.max(2, Math.round(m.radius / 3))}px">${side}<div class="m"><u style="border-radius:${m.buttons === 'pill' || m.composer === 'floating' ? 8 : m.buttons === 'square' ? 0 : 3}px;${m.composer === 'floating' ? 'bottom:7px;' : ''}"></u></div></div>`;
}
function modelSettingsRefresh() {
  const pane = document.querySelector('.setbody [data-pane="appearance"]'); if (!pane) return;
  let box = $('mdlBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'mdlBox'; box.className = 'setrow';
    const at = $('w2Theme'); if (at) at.before(box); else pane.appendChild(box);
  }
  const cur = (allModels().find(x => x.id === prefs.layout_model) || DEFAULT_MODELS[0]).id, custom = new Set((Array.isArray(prefs.layout_models) ? prefs.layout_models : []).map(x => x && x.id));
  box.innerHTML = `<label>Layout model</label><div class="vsub">Where the sidebar sits, how buttons are shaped, spacing and chat width. Make your own with JSON.</div>
    <div class="mdlgrid">${allModels().map(m => `<button type="button" class="mdlcard${m.id === cur ? ' on' : ''}" data-id="${esc(m.id)}">${modelPreview(m)}<b>${esc(m.name)}</b><small>${esc(m.description)}</small>${custom.has(m.id) ? '<small style="color:var(--acc)">Custom · <span data-del="' + esc(m.id) + '" style="text-decoration:underline">remove</span></small>' : ''}</button>`).join('')}</div>
    <button type="button" class="btn" id="mdlAdd">+ Add a model (JSON)…</button>`;
  box.querySelectorAll('.mdlcard').forEach(c => c.onclick = e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); prefs.layout_models = (prefs.layout_models || []).filter(x => x && x.id !== del.dataset.del); api().set_setting('layout_models', prefs.layout_models); if (prefs.layout_model === del.dataset.del) { prefs.layout_model = 'classic'; api().set_setting('layout_model', 'classic'); } applyLayoutModel(); modelSettingsRefresh(); return; }
    prefs.layout_model = c.dataset.id; api().set_setting('layout_model', c.dataset.id); applyLayoutModel(); modelSettingsRefresh();
  });
  $('mdlAdd').onclick = () => modelAddDialog('');
}
async function modelAddDialog(text) {
  const tpl = JSON.stringify({ id: 'mine', name: 'My model', description: 'My own layout', sidebar: 'right', buttons: 'pill', radius: 18, density: 'cozy', composer: 'floating', chatWidth: 820 }, null, 2);
  const ok = await ask({ title: 'Add a layout model', ok: 'Save model', html: `<div class="vsub" style="margin-bottom:8px">Fields: <code>id</code>, <code>name</code>, <code>description</code>, <code>sidebar</code> (${MODEL_SIDES.join(' / ')}), <code>buttons</code> (${MODEL_BTNS.join(' / ')}), <code>density</code> (${MODEL_DENS.join(' / ')}), <code>composer</code> (${MODEL_COMP.join(' / ')}), <code>radius</code> 0-32, <code>chatWidth</code> 600-1400, optional <code>sidebarWidth</code> 200-340 and <code>css</code> (filtered like custom CSS).</div>
    <textarea id="mdlJson" spellcheck="false">${esc(text || tpl)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px"><button type="button" class="btn sm" id="mdlFile">Import .json file…</button><input type="file" id="mdlFileIn" accept=".json,application/json" hidden></div>` });
  const ta = $('mdlJson');
  if (!ok) return;
  const raw = ta ? ta.value : '';
  let obj; try { obj = JSON.parse(raw); } catch (e) { toast('Layout model', 'That isn\'t valid JSON: ' + e.message); return modelAddDialog(raw); }
  const r = modelClean(obj);
  if (r.error) { toast('Layout model', r.error); return modelAddDialog(raw); }
  const list = (Array.isArray(prefs.layout_models) ? prefs.layout_models : []).filter(x => x && x.id !== r.model.id);
  if (list.length >= 20) { toast('Layout model', 'You can keep up to 20 custom models.'); return; }
  list.push(r.model); prefs.layout_models = list; prefs.layout_model = r.model.id;
  api().set_setting('layout_models', list); api().set_setting('layout_model', r.model.id);
  applyLayoutModel(); modelSettingsRefresh(); toast('Layout model', r.model.name + ' saved and applied.');
}
document.addEventListener('click', e => {   // the import button lives inside the dialog the ask() helper builds
  if (e.target && e.target.id === 'mdlFile') { const f = $('mdlFileIn'); if (f) { f.onchange = () => { const file = f.files && f.files[0]; if (!file || file.size > 40000) return; const rd = new FileReader(); rd.onload = () => { $('mdlJson').value = String(rd.result || ''); }; rd.readAsText(file); }; f.click(); } }
});
// ================================================================ density, chat width and font (Settings > Appearance)
// Fonts that come with Windows (the page may only use fonts already on the PC). '' = the theme's own font.
const UI_FONTS = [['', 'Default'], ['Bahnschrift, "Segoe UI", sans-serif', 'Modern'], ['"Trebuchet MS", "Segoe UI", sans-serif', 'Friendly'],
  ['Candara, Corbel, "Segoe UI", sans-serif', 'Soft'], ['Verdana, "Segoe UI", sans-serif', 'Easy to read'], ['Georgia, Cambria, "Times New Roman", serif', 'Serif'],
  ['"Cascadia Code", "Cascadia Mono", Consolas, monospace', 'Monospace']];
function applyLook() {
  document.body.classList.toggle('dense', prefs.density === 'compact');
  document.body.classList.toggle('roomy', prefs.density === 'roomy');
  document.documentElement.style.setProperty('--chatw', (Number(prefs.chat_width) || 820) + 'px');
  applyFont();
}
function applyFont() {   // on its own so a font change doesn't reset a layout model's density
  const f = UI_FONTS.find(x => x[0] && x[1] === prefs.ui_font);
  let st = $('fontCss'); if (!st) { st = document.createElement('style'); st.id = 'fontCss'; document.head.appendChild(st); }
  st.textContent = f ? `body, button, input, textarea, select { font-family: ${f[0]}; }` : '';
}
function lookSettingsRefresh() {
  const pane = document.querySelector('.setbody [data-pane="appearance"]'); if (!pane) return;
  if (!$('lookDensity')) {
    const row = document.createElement('div'); row.className = 'setrow';
    row.innerHTML = '<label>Font</label><select id="lookFont">' + UI_FONTS.map(x => `<option value="${esc(x[1])}">${esc(x[1])}</option>`).join('') + '</select>' +
      '<label style="margin-top:10px">Chat density</label><select id="lookDensity"><option value="cozy">Cozy</option><option value="compact">Compact</option><option value="roomy">Roomy</option></select>' +
      '<label style="margin-top:10px">Chat width <span id="lookWVal" class="vsub"></span></label><input type="range" id="lookWidth" min="640" max="1200" step="20" style="width:100%">';
    const calm = $('calmIn'); const at = calm && calm.closest('.setrow');
    if (at) at.after(row); else pane.appendChild(row);
    $('lookDensity').onchange = e => { prefs.density = e.target.value; api().set_setting('density', e.target.value); applyLook(); };
    $('lookFont').onchange = e => { prefs.ui_font = e.target.value; api().set_setting('ui_font', e.target.value); applyFont(); };
    $('lookWidth').oninput = e => { prefs.chat_width = Number(e.target.value); $('lookWVal').textContent = e.target.value + ' px'; applyLook(); };
    $('lookWidth').onchange = e => api().set_setting('chat_width', Number(e.target.value));
  }
  $('lookDensity').value = ['compact', 'roomy'].includes(prefs.density) ? prefs.density : 'cozy';
  $('lookFont').value = UI_FONTS.some(x => x[1] === prefs.ui_font) ? prefs.ui_font : 'Default';
  $('lookWidth').value = Number(prefs.chat_width) || 820; $('lookWVal').textContent = $('lookWidth').value + ' px';
}

// ================================================================ admin: crash reports
async function crashAdminLoad() {
  const box = $('crashAdmin'); if (!box || !sb) return;
  box.innerHTML = '<div class="fempty">Loading…</div>';
  const { data, error } = await sb.from('crash_reports').select('id,user_id,created_at,app_version,os,kind,message,stack,tester').order('created_at', { ascending: false }).limit(500);
  if (error) { box.innerHTML = `<div class="fempty">${esc(error.message)}</div>`; return; }
  // The same bug reported many times is one group: same kind and message once numbers, paths and ids are blanked out.
  const sig = c => c.kind + '|' + String(c.message).replace(/0x[0-9a-f]+|\d+/gi, '#').replace(/"[^"]*"|'[^']*'/g, '…').slice(0, 200);
  const groups = new Map();
  for (const c of data) { const k = sig(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const fromTester = g => g.some(c => c.tester);   // Testers' reports are read first
  const list = [...groups.values()].sort((a, b) => fromTester(b) - fromTester(a) || b.length - a.length || Date.parse(b[0].created_at) - Date.parse(a[0].created_at));
  const vers = g => [...new Set(g.map(c => c.app_version))].slice(0, 6).join(', ');
  const kindName = c => /^Minecraft crash/.test(c.message) ? 'Game crash' : /^Minecraft mod:/.test(c.message) ? 'Mod error' : c.kind;   // game reports are kind 'other'
  box.innerHTML = list.length ? `<div class="vsub" style="margin:4px 0 8px">${data.length} report${data.length === 1 ? '' : 's'} in ${list.length} group${list.length === 1 ? '' : 's'} (latest 500)</div>` + list.map((g, i) => {
    const c = g[0], users = new Set(g.map(x => x.user_id)).size;
    return `<div class="crashrow">${fromTester(g) ? `<b style="color:${ROLES.find(r => r.k === 'tester').c}">Tester</b> · ` : ''}<b>${esc(kindName(c))}</b> · <b>${g.length}×</b> · ${users} user${users === 1 ? '' : 's'} · v${esc(vers(g))} · last ${esc(new Date(c.created_at).toLocaleString())}
      <button class="btn sm danger" style="float:right" data-delg="${i}">Delete ${g.length === 1 ? '' : 'all ' + g.length}</button><div>${esc(c.message)}</div>
      <details><summary style="cursor:pointer">Latest trace · ${esc(c.os)}</summary><pre>${esc(c.stack)}</pre></details></div>`;
  }).join('') : '<div class="fempty">No crash reports.</div>';
  box.querySelectorAll('[data-delg]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await sb.from('crash_reports').delete().in('id', list[+b.dataset.delg].map(c => c.id));
    crashAdminLoad();
  });
}
window.crashAdminLoad = crashAdminLoad;

// ================================================================ starred messages (saved on this PC)
const starsGet = () => (Array.isArray(prefs.stars) ? prefs.stars : []);   // kept in the app's settings (the page itself has no localStorage)
const starsSet = l => { prefs.stars = l.slice(0, 100); try { api().set_setting('stars', prefs.stars); } catch (e) {} };
const starId = (chat, text) => { let h = 0; const t = chat + '|' + text; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); };
function addStar(el, text) {
  text = (text || '').trim(); if (!el || !text || el.querySelector('.xstar')) return;
  let m = el.querySelector('.meta'); if (!m) { m = document.createElement('div'); m.className = 'meta'; el.appendChild(m); }
  const id = starId(chatId || '', text), b = document.createElement('button'); b.className = 'xstar'; b.title = 'Star this reply';
  const paint = () => { const on = starsGet().some(x => x.id === id); b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); };
  b.onclick = () => { let l = starsGet(); if (l.some(x => x.id === id)) l = l.filter(x => x.id !== id); else l.unshift({ id, chat: chatId || '', text: text.slice(0, 1500), t: Date.now() }); starsSet(l); paint(); };
  paint(); m.appendChild(b);
}
{ const _xAddSpeak = xAddSpeak; xAddSpeak = function (el, text) { _xAddSpeak.apply(this, arguments); try { addStar(el, text); } catch (e) {} }; }
function showStars() {
  let d = $('starDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'starDlg'; d.style.cssText = 'width:min(640px,92vw);max-height:80vh;overflow:auto'; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d) d.close(); }); }
  const l = starsGet();
  d.innerHTML = '<h3 style="margin-top:0">★ Starred messages</h3>' + (l.length ? l.map(x => `<div class="starrow" data-id="${esc(x.id)}"><div class="stx">${esc(x.text)}</div><div class="stb"><span>${esc(new Date(x.t).toLocaleString())}</span><span style="flex:1"></span>${x.chat ? '<button class="btn sm" data-open>Open chat</button>' : ''}<button class="btn sm" data-copy>Copy</button><button class="btn sm danger" data-rm>Remove</button></div></div>`).join('') : '<p class="vsub">Nothing starred yet. Click ☆ under a reply to save it here.</p>') + '<div style="text-align:right;margin-top:10px"><button class="btn" id="starClose">Close</button></div>';
  $('starClose').onclick = () => d.close();
  d.querySelectorAll('.starrow').forEach(r => { const x = l.find(y => y.id === r.dataset.id);
    r.querySelector('[data-copy]').onclick = () => copyText(x.text).then(() => toast('Starred', 'Copied'));
    r.querySelector('[data-rm]').onclick = () => { starsSet(starsGet().filter(y => y.id !== x.id)); showStars(); };
    const o = r.querySelector('[data-open]'); if (o) o.onclick = () => { d.close(); showView('chat'); openChat(x.chat); }; });
  if (!d.open) d.showModal();
}
window.showStars = showStars;

// ================================================================ legal documents: viewer + "please accept" gate (shared by the app and auoris.org)
// Documents live in legal/*.md and are versioned by date in legal/legal.json (python tools/legal_bump.py). Whenever the version
// changes, everyone is asked to read and accept it again before they carry on.
const LEGAL = { data: null };
function legalMd(src, L) {
  const text = String(src).replace(/^# .*\n+/, '').replace(/\{\{operator\}\}/g, L.operator || 'Auoris').replace(/\{\{version\}\}/g, L.version)
    .replace(/\{\{contact\}\}/g, L.contact || 'the contact details on auoris.org');
  const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inl(para.join(' ')) + '</p>'); para = []; } };
  const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of text.split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim()) { flush(); close(); continue; }
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(l))) { flush(); close(); out.push(`<h${m[1].length + 1}>${inl(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = /^- (.*)$/.exec(l))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); }
    else if ((m = /^\d+\. (.*)$/.exec(l))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inl(m[1]) + '</li>'); }
    else { close(); para.push(l.trim()); }
  }
  flush(); close();
  return out.join('');
}
async function legalGet() { if (!LEGAL.data) LEGAL.data = await LEGAL_ENV.load(); return LEGAL.data; }
const LEGAL_CSS = `#legalGate, #legalView { position: fixed; inset: 0; z-index: 9600; background: #000b; display: flex; align-items: center; justify-content: center; padding: 18px; }
  #legalView { z-index: 9700; }
  .legalbox { width: min(720px, 100%); max-height: 92vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border2); border-radius: 18px; box-shadow: 0 24px 70px #000a; overflow: hidden; }
  .legalbox header { padding: 18px 22px 8px; } .legalbox header h2 { margin: 0 0 4px; font-size: 20px; } .legalbox header p { margin: 0; color: var(--muted); font-size: 13.5px; }
  .legalbox .lbody { padding: 6px 22px 12px; overflow-y: auto; flex: 1; font-size: 13.5px; line-height: 1.6; }
  .legalbox .lbody h2, .legalbox .lbody h3, .legalbox .lbody h4 { margin: 18px 0 6px; } .legalbox .lbody p, .legalbox .lbody li { color: var(--muted); } .legalbox .lbody b { color: var(--text); }
  .legalbox footer { padding: 12px 22px 18px; border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .legaldocs { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; } .legaldocs button { font-size: 12.5px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border2); background: var(--panel2); color: var(--text); cursor: pointer; }
  .legaltabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 22px 8px; } .legaltabs button { font-size: 12.5px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; } .legaltabs button.on { background: var(--panel2); color: var(--text); border-color: var(--border2); }
  .legalnote { font-size: 12px; color: var(--dim); margin-top: 12px; text-align: center; } .legalnote a { color: var(--acc); cursor: pointer; text-decoration: underline; }`;
function legalStyle() { if (!document.getElementById('legalCss')) { const s = document.createElement('style'); s.id = 'legalCss'; s.textContent = LEGAL_CSS; document.head.appendChild(s); } }
async function showLegal(id) {
  legalStyle();
  const L = await legalGet(); if (!L) return;
  let v = document.getElementById('legalView'); if (v) v.remove();
  v = document.createElement('div'); v.id = 'legalView';
  let cur = (L.docs.find(d => d.id === id) || L.docs[0]).id;
  const draw = () => {
    const d = L.docs.find(x => x.id === cur);
    v.innerHTML = `<div class="legalbox"><header><h2>${esc(d.title)}</h2><p>Version ${esc(L.version)}</p></header>
      <div class="legaltabs">${L.docs.map(x => `<button data-d="${esc(x.id)}" class="${x.id === cur ? 'on' : ''}">${esc(x.title)}</button>`).join('')}</div>
      <div class="lbody">${legalMd(d.text, L)}${L.changes && L.changes.length ? `<h3>Recent changes</h3><ul>${L.changes.slice(0, 5).map(c => `<li><b>${esc(c.version)}</b> - ${esc(c.summary)}</li>`).join('')}</ul>` : ''}</div>
      <footer><span style="flex:1"></span><button class="btn" id="legalClose">Close</button></footer></div>`;
    v.querySelectorAll('.legaltabs button').forEach(b => b.onclick = () => { cur = b.dataset.d; draw(); });
    v.querySelector('#legalClose').onclick = () => v.remove();
  };
  v.addEventListener('click', e => { if (e.target === v) v.remove(); });
  document.body.appendChild(v); draw();
}
let legalGateOpen = false;
async function legalGate(L, isUpdate) {
  if (legalGateOpen) return; legalGateOpen = true; legalStyle();
  const g = document.createElement('div'); g.id = 'legalGate';
  const latest = L.changes && L.changes[0];
  g.innerHTML = `<div class="legalbox"><header><h2>${isUpdate ? "We've updated our terms" : 'Before you start'}</h2>
    <p>${isUpdate ? 'Our legal documents changed. Please read and accept the new version to keep using Auoris.' : 'Please read and accept our legal documents to use Auoris.'}</p></header>
    <div class="lbody">${isUpdate && latest ? `<p><b>What changed:</b> ${esc(latest.summary)}</p>` : ''}
      <div class="legaldocs">${L.docs.map(d => `<button data-d="${esc(d.id)}">${esc(d.title)}</button>`).join('')}</div>
      <p style="margin-top:14px">In short: your local AI chats stay on your computer; messages and files you send online are stored on our servers so they can be delivered; messages are not end-to-end encrypted; we don't sell your data; you decide what the AI may do on your PC and you're responsible for approving it.</p></div>
    <footer><label style="display:flex;gap:8px;align-items:center;flex:1;min-width:220px;cursor:pointer"><input type="checkbox" id="legalAgree"> <span>I am at least 13 years old (16 where the law in my country requires it), and I have read and agree to the Terms of Service, Privacy Policy, Acceptable Use Policy and Subscription Terms (version ${esc(L.version)}).</span></label>
      <button class="btn" id="legalNo">${esc(LEGAL_ENV.declineLabel)}</button><button class="btn primary" id="legalYes" disabled>Agree and continue</button></footer></div>`;
  document.body.appendChild(g);
  g.querySelectorAll('.legaldocs button').forEach(b => b.onclick = () => showLegal(b.dataset.d));
  g.querySelector('#legalAgree').onchange = e => { g.querySelector('#legalYes').disabled = !e.target.checked; };
  g.querySelector('#legalNo').onclick = () => LEGAL_ENV.decline();
  g.querySelector('#legalYes').onclick = async () => {
    g.querySelector('#legalYes').disabled = true;
    try { await LEGAL_ENV.accept(L.version); g.remove(); legalGateOpen = false; } catch (e) { g.querySelector('#legalYes').disabled = false; alert('Could not save your choice: ' + (e.message || e)); }
  };
}

const LEGAL_ENV = {
  declineLabel: 'Quit Auoris',
  load: () => api().legal_get(),
  decline: () => api().close(),
  accept: async v => {
    if (typeof sb !== 'undefined' && sb && typeof me !== 'undefined' && me) { const { error } = await sb.rpc('accept_legal', { v, src: 'app' }); if (error) throw error; if (myProfile) myProfile.legal_version = v; }
    prefs.legal_accepted = v; await api().set_setting('legal_accepted', v);
  },
};
async function legalCheck(tries) {   // at start-up and after signing in
  legalStyle();
  let L = null; try { L = await legalGet(); } catch (e) {}
  if (!L || !L.version) {   // never fail open: retry, then ask the user to retry or quit
    LEGAL.data = null; tries = (tries || 0) + 1;
    if (tries < 4) return setTimeout(() => legalCheck(tries), 1500);
    return legalFailGate();
  }
  const acct = typeof sb !== 'undefined' && sb && me && myProfile;
  // acceptance belongs to the ACCOUNT when signed in (a different person signing in on this PC must accept too); the PC-wide setting covers signed-out use
  const accepted = acct ? myProfile.legal_version === L.version : prefs.legal_accepted === L.version;
  if (!accepted) return legalGate(L, acct ? !!myProfile.legal_version : !!prefs.legal_accepted);
  if (prefs.legal_accepted !== L.version) { prefs.legal_accepted = L.version; api().set_setting('legal_accepted', L.version); }
}
function legalFailGate() {
  if (document.getElementById('legalFail')) return;
  const g = document.createElement('div'); g.id = 'legalFail'; g.style.cssText = 'position:fixed;inset:0;z-index:9650;background:#000c;display:flex;align-items:center;justify-content:center';
  g.innerHTML = '<div class="legalbox" style="padding:22px"><h2 style="margin:0 0 6px">Couldn\'t load our terms</h2><p style="color:var(--muted)">Auoris needs to show you its Terms and Privacy Policy before you continue.</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="lfQuit">Quit Auoris</button><button class="btn primary" id="lfRetry">Try again</button></div></div>';
  document.body.appendChild(g);
  g.querySelector('#lfQuit').onclick = () => api().close();
  g.querySelector('#lfRetry').onclick = () => { g.remove(); legalCheck(); };
}
function legalSettingsRefresh() {
  const row = $('legalLinks'); if (!row || row.dataset.done) return; row.dataset.done = '1';
  legalGet().then(L => { if (!L) return; row.innerHTML = L.docs.map(d => `<button class="btn sm" data-d="${esc(d.id)}">${esc(d.title)}</button>`).join(' ') + `<div class="vsub" style="margin-top:6px">Version ${esc(L.version)}</div>`;
    row.querySelectorAll('button').forEach(b => b.onclick = () => showLegal(b.dataset.d)); }).catch(() => {});
}
document.addEventListener('click', e => { const a = e.target.closest('[data-legal]'); if (a) { e.preventDefault(); showLegal(a.dataset.legal); } });
window.legalCheck = legalCheck; window.showLegal = showLegal;
// Instant custom hover card for badges (the browser's own title tooltip is slow and plain): anything with data-tip.
(function () {
  let tip = null;
  const hide = () => { if (tip) tip.style.display = 'none'; };
  function show(el) {
    const t = el.getAttribute('data-tip'); if (!t) return;
    if (!tip) { tip = document.createElement('div'); tip.id = 'badgeTip'; document.body.appendChild(tip); }
    const lines = t.split('\n');
    tip.innerHTML = '<b>' + esc(lines[0]) + '</b>' + lines.slice(1).map(l => '<span>' + esc(l) + '</span>').join('');
    tip.style.display = 'block';
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.bottom + h + 12 > window.innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
  }
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); else hide(); });
  document.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
})();
window.startTour = startTour; window.crashFlush = crashFlush; window.tourMaybeStart = tourMaybeStart;   // used by the profile menu and sign-in code in the other scripts
openSettings = function () { const r = _openSettings.apply(this, arguments); try { themeSettingsRefresh(); modelSettingsRefresh(); dndSettingsRefresh(); typingSettingsRefresh(); crashSettingsRefresh(); lookSettingsRefresh(); cliSettingsRefresh(); lazySettingsRefresh(); legalSettingsRefresh(); } catch (e) { console.error(e); } return r; };

// ================================================================ 6. SIGN OUT EVERYWHERE ELSE
// supabase-js can't enumerate sessions, so there is deliberately no device list - just the one-shot scope:'others' sign-out.
const _openAccount = openAccount;
openAccount = function () {
  const r = _openAccount.apply(this, arguments);
  try {
    if (me && $('acctBody') && !$('w2SoSec')) {
      const sec = mk('div', { id: 'w2SoSec', className: 'asec' }, `<h4>Sign out everywhere else</h4><p>Ends your sign-in on every other browser and device but keeps this one signed in. Use it if you lost a device or signed in on a shared computer. (A list of individual devices isn't available.)</p>
        <div class="row"><button class="btn" id="w2SoBtn" type="button">Sign out other devices…</button></div>`);
      const first = $('acctBody').querySelector('.asec'); if (first) first.after(sec); else $('acctBody').prepend(sec);
      $('w2SoBtn').onclick = async () => {
        if (!(await ask({ title: 'Sign out all other devices?', html: 'Every other browser and device will be signed out and need to sign in again. This one stays signed in.', ok: 'Sign them out', danger: true }))) return;
        const { error } = await sb.auth.signOut({ scope: 'others' });
        if (error) return toast('Sign out other devices', error.message);
        toast('Done', 'All other devices were signed out.');
      };
    }
  } catch (e) { console.error(e); }
  return r;
};

// ================================================================ 5. SCREEN SHARING IN CALLS
// While a call is active: "Share screen" grabs getDisplayMedia. In a video call the camera sender's track is swapped (replaceTrack, no renegotiation);
// in an audio-only call the screen track is added to the PeerConnection and renegotiated with 'reoffer' / 'reanswer' over the existing call-signal
// broadcast. Each reoffer carries a per-sender counter (seq): stale/duplicate ones are ignored, a reanswer must echo the seq of my latest offer,
// and on offer collision ("glare") the polite peer (smaller user id) accepts theirs and re-offers afterwards while the other ignores it.
const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
const SH = { stream: null, track: null, sender: null, camTrack: null, mode: null, seq: 0, pending: 0, remoteSeq: 0 };
const isPolite = () => !!(me && callPeer && me.id < callPeer);
{
  const b = mk('button', { id: 'callShareBtn', className: 'icon callctrl', type: 'button', textContent: '🖥️' });
  b.title = 'Share screen'; b.hidden = !canShare; b.onclick = () => (SH.track ? shareStop(true) : shareStart());
  const h = $('callHangupBtn'); if (h) h.before(b);
}
function sharePaint() { const b = $('callShareBtn'); if (!b) return; b.classList.toggle('on', !!SH.track); b.title = SH.track ? 'Stop sharing' : 'Share screen'; }
function showRemoteVideoIf(has) { $('callRemoteVideo').hidden = !has; $('callAudioOnly').hidden = has; }
function syncRemoteVideo() {
  const s = $('callRemoteVideo').srcObject; if (!s) return;
  const has = s.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
  showRemoteVideoIf(has || callIsVideo);
}
async function shareRenegotiate() {
  if (!callPc || !callPc.createOffer || callState !== 'active') return;
  const seq = ++SH.seq; SH.pending = seq;
  try { const offer = await callPc.createOffer(); await callPc.setLocalDescription(offer); callSend('reoffer', { sdp: offer, seq }); }
  catch (e) { console.error('renegotiate', e); }
}
async function shareStart() {
  if (!canShare || callState !== 'active' || !callPc || !callPc.getSenders || SH.track) return;
  let ds;
  try { ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
  catch (e) { if (e && e.name !== 'NotAllowedError') toast('Screen share', "Couldn't start sharing this screen."); return; }
  const track = ds.getVideoTracks()[0]; if (!track) { ds.getTracks().forEach(t => t.stop()); return; }
  if (callState !== 'active' || !callPc) { ds.getTracks().forEach(t => t.stop()); return; }   // the call ended while the picker was open
  SH.stream = ds; SH.track = track; track.onended = () => shareStop(true);
  const camSender = callPc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (camSender) { SH.mode = 'replace'; SH.sender = camSender; SH.camTrack = camSender.track; try { await camSender.replaceTrack(track); } catch (e) { shareStop(false); return toast('Screen share', 'Could not switch to the screen.'); } }
  else { SH.mode = 'add'; SH.sender = callPc.addTrack(track, callLocalStream); await shareRenegotiate(); }
  $('callLocalVideo').srcObject = ds; $('callLocalVideo').hidden = false;
  sharePaint();
}
function shareStop(signal) {
  if (!SH.track) return;
  const mode = SH.mode, sender = SH.sender, cam = SH.camTrack, live = !!(callPc && callPc.getSenders && callState === 'active');
  SH.track = null; SH.sender = null; SH.camTrack = null; SH.mode = null;
  try { SH.stream && SH.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  SH.stream = null;
  if (live) {
    try {
      if (mode === 'replace' && sender) sender.replaceTrack(cam || null).catch(() => {});
      else if (mode === 'add' && sender) { callPc.removeTrack(sender); if (signal) shareRenegotiate(); }
    } catch (e) {}
    $('callLocalVideo').srcObject = callLocalStream; $('callLocalVideo').hidden = !callIsVideo;
  }
  sharePaint();
}
const _makePc = makePeerConnection;
makePeerConnection = function () {
  const pc = _makePc.apply(this, arguments);
  pc.addEventListener('track', e => {
    const t = e.track; t.onmute = t.onunmute = t.onended = syncRemoteVideo;
    if (t.kind === 'video') showRemoteVideoIf(true);
    if (e.streams[0]) e.streams[0].addEventListener('removetrack', syncRemoteVideo);
  });
  return pc;
};
const _enterActive = enterActiveCall;
enterActiveCall = function () { SH.seq = 0; SH.pending = 0; SH.remoteSeq = 0; const r = _enterActive.apply(this, arguments); sharePaint(); return r; };
const _endCall = endCall;
endCall = function () { shareStop(false); SH.seq = SH.pending = SH.remoteSeq = 0; return _endCall.apply(this, arguments); };
const _handleSignal = handleCallSignal;
handleCallSignal = async function (p) {
  if (p && (p.kind === 'reoffer' || p.kind === 'reanswer')) {
    // only meaningful inside the active call it belongs to; stale/foreign ones are dropped
    if (callState !== 'active' || !callPc || !callPc.setRemoteDescription || p.from !== callPeer || p.callId !== callId || !Number.isInteger(p.seq)) return;
    try {
      if (p.kind === 'reoffer') {
        if (p.seq <= SH.remoteSeq) return;
        const collision = callPc.signalingState !== 'stable';
        if (collision && !isPolite()) return;
        SH.remoteSeq = p.seq;
        await callPc.setRemoteDescription(p.sdp);   // implicit rollback of our own pending offer when we're the polite side
        const ans = await callPc.createAnswer(); await callPc.setLocalDescription(ans);
        callSend('reanswer', { sdp: ans, seq: p.seq });
        if (collision && SH.track && SH.mode === 'add') setTimeout(shareRenegotiate, 250);   // our offer was rolled back - send it again
      } else {
        if (p.seq !== SH.pending || callPc.signalingState !== 'have-local-offer') return;
        SH.pending = 0; await callPc.setRemoteDescription(p.sdp);
      }
    } catch (e) { console.error('call renegotiation', e); }
    return;
  }
  return _handleSignal.apply(this, arguments);
};

// ================================================================ 1. COMMAND PALETTE (Ctrl+K)
function palItems() {
  const out = [], add = (group, label, hint, run, kw) => out.push({ group, label, hint: hint || '', run, kw: kw || '' });
  [['chat', 'Chat'], ['explore', 'Explore'], ['routines', 'Routines'], ['browser', 'Browser'], ['artifacts', 'Artifacts'], ['minecraft', 'Minecraft'],
   ['messages', 'Messages'], ['projects', 'Projects'], ['plus', 'Plus']].forEach(([v, n]) => add('Go to', n, 'view', () => showView(v), 'switch view open'));
  COMMANDS.forEach(c => {
    const prefill = () => { showView('chat'); input.value = c.cmd + ' '; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); };
    const base = () => { try { return c.arg && !c.opts ? prefill() : c.run(''); } catch (e) { toast('Command', e.message || String(e)); } };
    add('Command', c.cmd, c.desc, base, 'slash run');
    if (c.opts) c.opts.forEach(o => add('Command', c.cmd + ' ' + o, c.desc, () => { try { c.run(o); } catch (e) { toast('Command', e.message || String(e)); } }, 'slash run'));
  });
  document.querySelectorAll('.settabs [data-tab]').forEach(b => { const n = (b.querySelector('b') || b).textContent.trim(); add('Settings', n, 'settings tab', () => openSettings(b.dataset.tab), 'preferences'); });
  add('Action', 'Toggle theme (next preset)', themeById(prefs.theme_id).name, () => { const i = THEMES.findIndex(t => t.id === themeById(prefs.theme_id).id); save('theme_id', THEMES[(i + 1) % THEMES.length].id); applyTheme(); }, 'dark light appearance');
  add('Action', 'Toggle calm mode', prefs.calm ? 'on' : 'off', () => { save('calm', !prefs.calm); applyPrefs(); }, 'reduce animations motion');
  add('Action', 'Toggle do not disturb', dndNow() ? 'on' : 'off', () => dndToggle(), 'dnd quiet moon');
  add('Action', 'Search chats', 'sidebar', () => { ensureSide(); $('search').focus(); }, 'find');
  (allChats || []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 25).forEach(c => add('Chat', c.title || 'Untitled', 'recent chat', () => { showView('chat'); openChat(c.id); }));
  if (svCache && svCache.servers) svCache.servers.forEach(s => add('Server', s.name, 'server', () => { msgMode = 'server'; svCache.sid = s.id; svCache.cid = null; showView('messages'); }, 'servers'));
  if (grCache && grCache.groups) grCache.groups.forEach(g => add('Group', g.name, 'group chat', async () => { showView('messages'); try { await msgOpenGroupThread(g.id); } catch (e) {} }, 'groups'));
  (friendsCache || []).filter(f => f.status === 'accepted').forEach(f => add('DM', f.other.display_name || f.other.username, '@' + f.other.username, () => { showView('messages'); openDm(f.other.id); }, 'message friend dm'));
  return out;
}
const PAL = { items: [], shown: [], sel: 0 };
function palRender() {
  const q = $('w2PalIn').value.trim(), list = $('w2PalList');
  const scored = [];
  for (const it of PAL.items) {
    if (!q) { scored.push({ it, score: 0, pos: [] }); continue; }
    let f = fuzzy(q, it.label), pos = f ? f.pos : [];
    if (!f) { const all = fuzzy(q, it.label + ' ' + it.hint + ' ' + it.kw + ' ' + it.group); if (!all) continue; f = { score: all.score - 400, pos: [] }; }
    scored.push({ it, score: f.score, pos });
  }
  if (q) scored.sort((a, b) => b.score - a.score);
  PAL.shown = scored.slice(0, 60); if (PAL.sel >= PAL.shown.length) PAL.sel = Math.max(0, PAL.shown.length - 1);
  list.innerHTML = PAL.shown.length ? PAL.shown.map((s, i) => {
    const set = new Set(s.pos), l = [...s.it.label].map((ch, k) => set.has(k) ? `<mark>${esc(ch)}</mark>` : esc(ch)).join('');
    return `<div class="pi${i === PAL.sel ? ' sel' : ''}" data-i="${i}" role="option"><span class="g">${esc(s.it.group)}</span><span class="l">${l}</span><span class="h">${esc(s.it.hint)}</span></div>`;
  }).join('') : '<div class="none">No matches</div>';
  const el = list.querySelector('.sel'); if (el) el.scrollIntoView({ block: 'nearest' });
}
function palRun(i) {
  const s = PAL.shown[i]; if (!s) return;
  $('w2Pal').close();
  setTimeout(() => { try { const r = s.it.run(); if (r && r.catch) r.catch(e => toast('Palette', e.message || String(e))); } catch (e) { toast('Palette', e.message || String(e)); } }, 0);
}
function palOpen() {
  let d = $('w2Pal');
  if (!d) {
    d = mk('dialog', { id: 'w2Pal' }, `<input id="w2PalIn" placeholder="Type a command, view, chat or person…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true"><div id="w2PalList" role="listbox"></div><div id="w2PalFoot">↑ ↓ to move · Enter to run · Esc to close · Ctrl+K toggles</div>`);
    document.body.appendChild(d);
    $('w2PalIn').addEventListener('input', () => { PAL.sel = 0; palRender(); });
    $('w2PalIn').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); PAL.sel = Math.min(PAL.shown.length - 1, PAL.sel + 1); palRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); palRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); palRun(PAL.sel); }
    });
    $('w2PalList').addEventListener('mousemove', e => { const r = e.target.closest('.pi'); if (r && +r.dataset.i !== PAL.sel) { PAL.sel = +r.dataset.i; palRender(); } });
    $('w2PalList').addEventListener('click', e => { const r = e.target.closest('.pi'); if (r) palRun(+r.dataset.i); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  PAL.items = palItems(); PAL.sel = 0; $('w2PalIn').value = '';
  if (!d.open) d.showModal();
  palRender(); $('w2PalIn').focus();
}
// capture phase on window + stopImmediatePropagation so the old "Ctrl+K focuses the chat search" handler doesn't also fire (that one lives on as Ctrl+Shift+K
// because it doesn't check Shift, and as the palette action "Search chats").
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); e.stopImmediatePropagation();
    const d = $('w2Pal'); if (d && d.open) d.close(); else palOpen();
  }
}, true);
COMMANDS.push({ cmd: '/palette', desc: 'Open the command palette (Ctrl+K)', run: () => palOpen() });

applyTheme(); dndPaint();
})();
