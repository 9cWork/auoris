// Anti-clickjacking (GitHub Pages can't send X-Frame-Options): never run inside someone else's frame.
try { if (window.top !== window.self) { document.documentElement.style.display = 'none'; window.top.location = window.self.location; } } catch (e) { document.documentElement.style.display = 'none'; }
// auoris.org - one small single-page app with hash routes (#/servers, #/dms/...). Same Supabase accounts as the desktop app.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SUPABASE_URL = 'https://utqswadleapgszwbkvzo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GatsXVrXWFclOrTpAjg3Xw_Jdyra6Hf';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const PCOLS = 'id,username,display_name,color,is_admin,is_mod,staff_since,created_at,pronouns,plus_since,plus_until,banner_color,banner_url,avatar_url,effect,discord_name,bio';

let me = null, myProfile = null, pageSubs = [];
const profiles = new Map();
async function getProfiles(ids) {
  const missing = [...new Set(ids)].filter(id => id && !profiles.has(id));
  if (missing.length) {
    const { data } = await sb.from('profiles').select(PCOLS).in('id', missing);
    (data || []).forEach(p => profiles.set(p.id, p));
  }
  return ids.map(id => profiles.get(id));
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
}
const fail = e => toast(e && e.message ? e.message : String(e));
// Edge Function errors come back as a Response in error.context - dig the server's message out of it.
async function fnError(error) { try { const b = await error.context.json(); if (b && b.error) return b.error; } catch (e) {} return (error && error.message) || String(error); }

// ---------------------------------------------------------------- safety: block / mute / report
// Only I can read my own user_blocks rows, so nobody is ever told they were blocked or muted. 'block' is also enforced
// server-side (DMs, friend requests, group invites - cloud/schema.sql); hiding their messages is done here, client-side.
const blocks = new Map();  // user id -> 'block' | 'mute'
async function loadBlocks() {
  blocks.clear();
  try { const { data, error } = await sb.from('user_blocks').select('blocked,kind'); if (error) throw error; (data || []).forEach(r => blocks.set(r.blocked, r.kind)); }
  catch (e) { console.warn('blocks', e); }
}
const isHidden = id => !!id && blocks.has(id);
async function setRelation(uid, kind) {  // kind: 'block' | 'mute' | null (remove). Resolves true on success.
  let error;
  if (!kind) ({ error } = await sb.from('user_blocks').delete().eq('blocker', me.id).eq('blocked', uid));
  else if (blocks.has(uid)) ({ error } = await sb.from('user_blocks').update({ kind }).eq('blocker', me.id).eq('blocked', uid));
  else ({ error } = await sb.from('user_blocks').insert({ blocker: me.id, blocked: uid, kind }));
  if (error) { fail(error); return false; }
  if (kind) blocks.set(uid, kind); else blocks.delete(uid);
  if (kind === 'block') await loadFriends().catch(() => {});  // blocking ends any friendship server-side
  return true;
}
const REPORT_REASONS = [['spam', 'Spam'], ['harassment', 'Harassment or bullying'], ['hate', 'Hate speech'], ['sexual', 'Sexual or explicit content'],
  ['scam', 'Scam or phishing'], ['malware', 'Malware or unsafe file'], ['other', 'Something else']];
const REPORT_TABLE_LABEL = { messages: 'Direct message', group_messages: 'Group chat', channel_messages: 'Server channel', ai_project_messages: 'AI project' };
function openReport(table, m) {
  document.querySelector('.pcard')?.remove();
  const card = document.createElement('div'); card.className = 'pcard';
  card.innerHTML = `<div class="pcard-in" style="padding:20px"><h3 style="margin:0 0 4px">Report message</h3>
    <p class="muted small" style="margin:0 0 6px">This goes privately to Auoris staff. The person you report is not told.</p>
    <label class="lbl">Reason</label><select class="in" id="rpReason">${REPORT_REASONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
    <label class="lbl">Note (optional)</label><textarea class="in" id="rpNote" rows="3" maxlength="500" placeholder="Anything that helps us review this"></textarea>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="rpCancel">Cancel</button><button class="btn primary" id="rpSend">Send report</button></div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  card.querySelector('#rpCancel').onclick = () => card.remove();
  card.querySelector('#rpSend').onclick = async e => {
    e.target.disabled = true;
    const note = card.querySelector('#rpNote').value.trim().slice(0, 500);
    const { error } = await sb.from('message_reports').insert({ reporter: me.id, message_table: table, message_id: m.id, reason: card.querySelector('#rpReason').value, note: note || null });
    if (error) { e.target.disabled = false; return fail(error); }
    card.remove(); toast('Report sent. Thanks - our team will review it.');
  };
}

// ---------------------------------------------------------------- voice input (speech-to-text dictation)
// Runs in the user's own browser (not an embedded webview), so SpeechRecognition support is the normal
// Chromium/Safari/Firefox landscape - feature-detect and just hide the mic button where it's missing.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
// attachMic(btn, getEl): getEl is a function returning the current <input> to dictate into, since chatPane()
// composers can be torn down and rebuilt (e.g. switching DM/channel), so the element instance can change.
// Microphone blocked: say exactly where to switch it on instead of just "blocked".
function micBlockedMsg() {
  const ua = navigator.userAgent;
  const where = /Firefox/.test(ua) ? 'Click the permissions icon left of the address bar, then clear the blocked Microphone entry.'
    : /Safari/.test(ua) && !/Chrome|Chromium/.test(ua) ? 'Open Safari → Settings → Websites → Microphone and set auoris.org to Allow.'
    : 'Click the lock icon in the address bar → Microphone → Allow, then tap the mic again.';
  toast('Microphone is turned off for this site. ' + where);
}
function attachMic(btn, getEl) {
  if (!btn) return;
  if (!SpeechRec) { btn.hidden = true; return; }
  btn.hidden = false;
  let rec = null, listening = false;
  const stop = () => { listening = false; btn.classList.remove('mic-rec'); };
  let starting = false;
  btn.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    if (listening) { try { rec && rec.stop(); } catch (err) {} return; }
    if (starting) return;
    const el = getEl(); if (!el) return;
    starting = true;
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); }   // shows the browser's permission prompt
    catch (err) {
      starting = false;
      return err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? micBlockedMsg() : toast(err && err.name === 'NotFoundError' ? 'No microphone was found.' : "Couldn't use the microphone - another app may be using it.");
    }
    starting = false;
    const base = el.value;
    rec = new SpeechRec();
    rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = true;
    listening = true; btn.classList.add('mic-rec');
    rec.onresult = ev => {
      if (!btn.isConnected) { try { rec.stop(); } catch (x) {} return; }   // composer was swapped out (switched chat): stop listening
      let finalText = '', interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      const joined = finalText + interim;
      el.value = joined ? base + (base && !/\s$/.test(base) ? ' ' : '') + joined : base;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = ev => {
      stop();
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') return micBlockedMsg();
      toast("Voice input isn't available right now.");
    };
    rec.onend = stop;
    try { rec.start(); } catch (err) { stop(); toast("Voice input isn't available right now."); }
  };
}

// ---------------------------------------------------------------- badges
const ICON = {
  shield: c => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path fill="#fff" d="m10.6 15.6-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4z"/></svg>`,
  crown: c => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1" fill="${c}"/></svg>`,
  // Plus: a sun with an asteroid swinging past it
  plus: c => `<svg viewBox="0 0 24 24"><g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="12" r="4.2" fill="${c}" stroke="none"/>
    <path d="M10 3.5v2M10 18.5v2M1.5 12h2M16.5 12h2M4 6l1.4 1.4M14.6 16.6 16 18M4 18l1.4-1.4M14.6 7.4 16 6"/></g>
    <path fill="${c}" d="M19.2 3.3c1.3-.3 2.4.6 2.2 1.9-.2 1.1-1.3 1.9-2.4 1.6-1.2-.3-1.6-1.6-1-2.6.3-.5.7-.8 1.2-.9z"/>
    <path d="M17.6 7.2c-.9.9-1.9 1.4-2.8 1.5" stroke="${c}" stroke-width="1" stroke-linecap="round" fill="none" opacity=".7"/></svg>`,
  check: c => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${c}"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m7.5 12.5 3 3 6-6.5"/></svg>`,
};
// Plus colour by continuous months subscribed. Under 3 months the logo is white.
const TIERS = [[36, 'Pink', '#ff4fa3'], [24, 'Purple', '#8e44ec'], [18, 'Amethyst', '#b07cf0'], [12, 'Diamond', '#5ee6f0'],
  [9, 'Iron', '#c9ccd1'], [6, 'Gold', '#f2c14e'], [3, 'Copper', '#c87533']];
const isPlus = p => !!(p && p.plus_until && new Date(p.plus_until) > new Date());
const plusMonths = p => isPlus(p) && p.plus_since ? Math.floor((Date.now() - new Date(p.plus_since)) / (30.44 * 864e5)) : 0;
function plusTier(p) {
  if (!isPlus(p)) return null;
  const m = plusMonths(p), t = TIERS.find(([n]) => m >= n);
  return t ? { name: t[1], color: t[2], months: m } : { name: 'Plus', color: '#ffffff', months: m };
}
function crownBadge(title, px) {   // Owner: a red crown
  const s = px || 16, t = String(title).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg class="lbadge" viewBox="0 0 24 24" width="${s}" height="${s}" role="img" data-tip="${t}"><path fill="#ef3b3b" d="M2.5 7.5l4.8 4.3L12 4l4.7 7.8 4.8-4.3-1.9 11H4.4z"/><rect x="4.4" y="20" width="15.2" height="2.2" rx="1.1" fill="#c42626"/></svg>`;
}
function logoBadge(color, title, px) {   // the Auoris logo, recoloured: a picture badge instead of a text pill
  const m = /^#([0-9a-f]{6})$/i.exec(color || ''); let f = '';
  if (m) {
    const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    f = d / (mx || 1) < .15 ? `grayscale(1) brightness(${(0.6 + mx * 0.9).toFixed(2)})` : `hue-rotate(${Math.round(h - 218)}deg) brightness(1.1)`;
  }
  const s = px || 16;
  return `<img class="lbadge" src="/img/badge.png" alt="" data-tip="${String(title).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}" style="width:${s}px;height:${s}px;filter:${f}">`;
}
function badges(p, serverRole) {
  if (!p) return '';
  const b = [];
  const day = d => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''), L = (...x) => x.filter(Boolean).join('\n');
  if ((p.username || '').toLowerCase() === 'auoris') b.push([L('Owner', 'Founder of Auoris', p.created_at && 'Since ' + day(p.created_at)), crownBadge(L('Owner', 'Founder of Auoris', p.created_at && 'Since ' + day(p.created_at)), 16)]);
  else if (p.is_admin) { const t = L('Admin', 'Helps run Auoris', 'Since ' + day(p.staff_since || p.created_at)); b.push([t, logoBadge('#ff9f43', t, 16)]); }
  else if (p.is_mod) { const t = L('Moderator', 'Keeps Auoris safe', 'Since ' + day(p.staff_since || p.created_at)); b.push([t, logoBadge('#4caf50', t, 16)]); }
  if (serverRole === 'owner') b.push(['Server owner', crownBadge('Server owner', 16)]);
  else if (serverRole === 'admin') b.push(['Server admin', logoBadge('#ff9f43', 'Server admin', 16)]);
  else if (serverRole === 'moderator') b.push(['Server moderator', logoBadge('#4caf50', 'Server moderator', 16)]);
  const t = plusTier(p);
  if (t) { const tt = L('Auoris Plus · ' + t.name, t.months ? t.months + ' month' + (t.months === 1 ? '' : 's') + ' of Plus' : 'New to Plus', p.plus_since && 'Awarded ' + day(p.plus_since)); b.push([tt, logoBadge(t.color, tt, 16)]); }
  const merged = new Map();  // same icon twice (e.g. site Owner + server owner) shows once with both titles
  for (const [title, svg] of b) merged.set(svg, merged.has(svg) ? merged.get(svg) + ' · ' + title : title);
  return merged.size ? `<span class="badges">${[...merged].map(([svg, title]) => `<span class="bdg" data-tip="${esc(title)}">${svg}</span>`).join('')}</span>` : '';
}
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
const dname = p => p ? (p.display_name || p.username) : 'Unknown';
// Names and avatars stay plain everywhere; badges only appear on the profile card that opens when you click one.
const who = (p, role) => p ? ` data-uid="${esc(p.id)}"${role ? ` data-role="${esc(role)}"` : ''}` : '';
// Real profile picture when the account has one (avatar_url is a basic/free feature, unlike the Plus-gated
// banner_url above) - otherwise the same colored-initial fallback as before uploads existed.
const avatar = (p, cls = '', role) => (p && p.avatar_url)
  ? `<span class="av img ${cls}"${who(p, role)} style="background-image:url('${encodeURI(p.avatar_url)}')"></span>`
  : `<span class="av ${cls}"${who(p, role)} style="--c:${esc((p && p.color) || '#5b9dff')}">${esc([...dname(p)][0].toUpperCase())}</span>`;
const nameHtml = (p, role) => `<span class="name"${who(p, role)}>${esc(dname(p))}</span>`;
const plainAv = (p, cls = '') => avatar(p, cls).replace(/ data-uid="[^"]*"/, '');  // for rows whose click does something else

async function showProfileCard(uid, role) {
  document.querySelector('.pcard')?.remove();
  const [p] = await getProfiles([uid]); if (!p) return;
  const t = plusTier(p), isMe = me && uid === me.id;
  const friend = friends.find(f => f.other === uid);
  const rel = blocks.get(uid) || null;
  const card = document.createElement('div'); card.className = 'pcard';
  const bannerStyle = p.banner_url && isPlus(p) ? `--bc:url('${encodeURI(p.banner_url)}')` : `--bc:${p.banner_color || '#1c2a52'}`;
  card.innerHTML = `<div class="pcard-in"><div class="banner ${p.effect === 'aurora' && isPlus(p) ? 'effect-aurora' : ''}" style="${bannerStyle};height:90px"></div>
    <div class="profhead" style="margin-top:-34px">${avatar(p, 'lg').replace(/ data-uid="[^"]*"/, '')}</div>
    <div style="padding:6px 20px 20px"><h3 style="margin:4px 0 0">${esc(dname(p))}${badges(p, role)}</h3><div class="muted small">@${esc(p.username)}</div>
      ${t ? `<div class="pluspill" style="margin-top:10px">${ICON.plus(t.color).replace('<svg', '<svg width="15" height="15"')} Auoris Plus${t.name !== 'Plus' ? ` · ${esc(t.name)}` : ''}${t.months ? ` · ${t.months} months` : ''}</div>` : ''}
      ${p.bio ? `<p style="margin:12px 0 0">${emojify(esc(p.bio))}</p>` : ''}
      ${p.discord_name ? `<p class="muted small" style="margin:10px 0 0">Discord: ${esc(p.discord_name)}</p>` : ''}
      <div class="row" style="margin-top:14px">${isMe ? '<a class="btn sm" href="/profile">Edit profile</a>'
        : friend && friend.status === 'accepted' ? `<a class="btn sm primary" href="/messages/dm/${esc(uid)}">Message</a>` : me && !friend && rel !== 'block' ? '<button class="btn sm" id="pcAdd">Add friend</button>' : ''}
        </div><div class="row" id="pcExtra" style="margin-top:8px"></div>
        ${me && !isMe ? `<div class="row" style="margin-top:8px">${rel === 'block' ? '' : `<button class="btn sm" id="pcMute">${rel === 'mute' ? 'Unmute' : 'Mute'}</button>`}<button class="btn sm danger" id="pcBlock">${rel === 'block' ? 'Unblock' : 'Block'}</button></div>` : ''}</div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  if (card.querySelector('#pcAdd')) card.querySelector('#pcAdd').onclick = async () => {
    const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: uid });
    if (error) return fail(error.code === '23505' ? 'You already have a request with them.' : error);
    toast(`Friend request sent to @${p.username}`); card.remove();
  };
  if (profileCardExtra) profileCardExtra(uid, card.querySelector('#pcExtra'), () => card.remove());
  const relDone = async (kind, msg) => { if (!(await setRelation(uid, kind))) return; card.remove(); toast(msg); route(); };
  if (card.querySelector('#pcMute')) card.querySelector('#pcMute').onclick = () => relDone(rel === 'mute' ? null : 'mute', rel === 'mute' ? `Unmuted @${p.username}` : `Muted @${p.username} - their messages are hidden for you`);
  if (card.querySelector('#pcBlock')) card.querySelector('#pcBlock').onclick = () => {
    if (rel === 'block') return relDone(null, `Unblocked @${p.username}`);
    if (!confirm(`Block @${p.username}? They won't be able to message you or send friend requests, any friendship ends, and you won't see their messages. They are not told.`)) return;
    relDone('block', `Blocked @${p.username}`);
  };
}
let profileCardExtra = null;  // a page (e.g. a server) can add its own buttons, like role management
document.addEventListener('click', e => {
  const el = e.target.closest('[data-uid]');
  if (!el || el.closest('.pcard')) return;
  e.preventDefault(); e.stopPropagation();
  showProfileCard(el.dataset.uid, el.dataset.role || null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelector('.pcard')?.remove(); });
function renderBody(text, custom) {
  const html = emojify(esc(text), custom);
  const plain = text.replace(EMOJI_RE, (m, k) => EMOJI[k] || m).replace(/\s/g, '');
  const only = plain && /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|️|‍)+$/u.test(plain)
    && [...plain.matchAll(/\p{Extended_Pictographic}|\p{Regional_Indicator}/gu)].length <= 3;
  return only ? `<span class="emoji-only">${html}</span>` : html;
}

// ---------------------------------------------------------------- edit / delete own messages, webhook (BOT) posts, scheduled send
// Edits: a sender may change only the BODY of their own message for 24 h (cloud/schema.sql stamps edited_at); deletes are allowed any time.
// Webhook posts are stored with sender = the server owner and webhook_name set, so they are told apart by webhook_name - never render them as the owner.
const EDIT_WINDOW_MS = 24 * 3600e3;
const authorKey = m => (m.webhook_name ? 'wh:' + m.webhook_name : m.sender);
const editedTag = m => (m && m.edited_at ? `<span class="edited" title="Edited ${esc(new Date(m.edited_at).toLocaleString())}">(edited)</span>` : '');
const httpsHost = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' && !x.username && !x.password ? x.host : null; } catch { return null; } };
// A webhook embed card: title (a link only when https), description, colour bar. Everything is escaped.
function embedHtml(m) {
  const e = m && m.webhook_name && m.webhook_embed; if (!e || typeof e !== 'object') return '';
  const col = /^#[0-9a-fA-F]{6}$/.test(e.color || '') ? e.color : '#5b9dff';
  const host = e.url ? httpsHost(e.url) : null;
  const t = e.title ? (host ? `<a class="wt" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(host)}">${esc(e.title)}</a>` : `<div class="wt">${esc(e.title)}</div>`) : '';
  return `<div class="whembed" style="--c:${esc(col)}">${t}${e.description ? `<div class="wd">${esc(e.description)}</div>` : ''}</div>`;
}

// ---- scheduled send: a clock button in each composer opens this popover (quick presets + custom time, and your pending list)
const SCHED_MIN_MS = 2 * 60e3, SCHED_MAX_MS = 30 * 86400e3;
const schedInputVal = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function schedLabels(rows) {
  const lab = new Map(), ids = t => [...new Set(rows.filter(r => r.target_table === t).map(r => r.target_id))];
  const dms = ids('messages'); if (dms.length) { await getProfiles(dms); dms.forEach(id => lab.set(id, 'DM: ' + dname(profiles.get(id)))); }
  const g = ids('group_messages'), c = ids('channel_messages');
  if (g.length) { const { data } = await sb.from('group_chats').select('id,name').in('id', g); (data || []).forEach(x => lab.set(x.id, '👥 ' + x.name)); }
  if (c.length) { const { data } = await sb.from('channels').select('id,name,servers(name)').in('id', c); (data || []).forEach(x => lab.set(x.id, (x.servers ? x.servers.name + ' / ' : '') + '#' + x.name)); }
  return lab;
}
// o: { table, target (recipient id / group id / channel id), getText(), onScheduled() }
async function schedOpen(anchor, o) {
  document.querySelector('.schedpop')?.remove();
  if (!me) return;
  const pop = document.createElement('div'); pop.className = 'schedpop';
  const text = o.getText();
  pop.innerHTML = `<div class="sp-h">🕒 Schedule send</div>
    <div class="sp-prev">${text ? esc(text.slice(0, 140)) : '<i>Type a message first, then schedule it.</i>'}</div>
    <div class="row"><button type="button" class="btn sm" data-p="1h">In 1 hour</button><button type="button" class="btn sm" data-p="tom">Tomorrow 9:00</button></div>
    <label class="lbl" style="margin:4px 0 0">Custom time (your local time)</label><input type="datetime-local" class="in sp-when">
    <div class="row"><button type="button" class="btn primary sm sp-go"${text ? '' : ' disabled'}>Schedule</button><button type="button" class="btn sm sp-x">Close</button></div>
    <div class="small muted">Text only for now. Sent from your account at that time, if you can still message them then.</div>
    <div class="sp-h" style="margin-top:8px">Scheduled by you</div><div class="sp-list"><div class="empty">Loading…</div></div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 328)) + 'px'; pop.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
  const inp = pop.querySelector('.sp-when'), go = pop.querySelector('.sp-go');
  inp.min = schedInputVal(new Date(Date.now() + SCHED_MIN_MS)); inp.max = schedInputVal(new Date(Date.now() + SCHED_MAX_MS));
  pop.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    const d = new Date();
    if (b.dataset.p === '1h') d.setHours(d.getHours() + 1); else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    inp.value = schedInputVal(d);
  });
  pop.querySelector('.sp-x').onclick = () => pop.remove();
  const list = pop.querySelector('.sp-list');
  const loadList = async () => {
    const { data, error } = await sb.from('scheduled_messages').select('id,target_table,target_id,body,send_at,status').in('status', ['pending', 'failed']).order('send_at').limit(50);
    if (!pop.isConnected) return;
    if (error) { list.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    if (!data.length) { list.innerHTML = '<div class="empty">Nothing scheduled.</div>'; return; }
    const lab = await schedLabels(data); if (!pop.isConnected) return;
    list.innerHTML = data.map(x => `<div class="sp-item"><div style="min-width:0;flex:1"><div class="sp-meta"><b>${esc(lab.get(x.target_id) || 'A conversation')}</b> · ${x.status === 'failed' ? '<span style="color:var(--err)">Couldn\'t send</span>' : esc(new Date(x.send_at).toLocaleString())}</div><div class="sp-body">${esc(x.body.slice(0, 90))}</div></div><button type="button" class="btn sm" data-id="${esc(x.id)}" data-f="${x.status === 'failed' ? 1 : 0}">${x.status === 'failed' ? 'Remove' : 'Cancel'}</button></div>`).join('');
    list.querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const q = b.dataset.f === '1' ? sb.from('scheduled_messages').delete().eq('id', b.dataset.id) : sb.from('scheduled_messages').update({ status: 'canceled' }).eq('id', b.dataset.id).eq('status', 'pending');
      const { error: e2 } = await q; if (e2) { b.disabled = false; return fail(e2); }
      loadList();
    });
  };
  loadList();
  go.onclick = async () => {
    const body = o.getText(); if (!body) return toast('Type a message first.');
    const when = new Date(inp.value); if (!inp.value || isNaN(when)) return toast('Pick a date and time, or use a quick option.');
    const d = when.getTime() - Date.now();
    if (d < SCHED_MIN_MS) return toast('Pick a time at least 2 minutes from now.');
    if (d > SCHED_MAX_MS) return toast('You can schedule up to 30 days ahead.');
    go.disabled = true;
    const { error } = await sb.from('scheduled_messages').insert({ sender: me.id, target_table: o.table, target_id: o.target, body, send_at: when.toISOString() });
    go.disabled = false;
    if (error) return fail(error);
    if (o.onScheduled) o.onScheduled();
    pop.remove(); toast('Message scheduled for ' + when.toLocaleString());
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!pop.isConnected) return document.removeEventListener('click', off); if (!pop.contains(ev.target) && !anchor.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }));
}

// ---- server settings: webhooks (owner / admins). The URL is shown ONCE; only a hash of the secret is stored.
async function mgWebhooksMount(s, host) {
  if (!host || !svCache || !svCache.chans) return;
  const sec = document.createElement('div');
  sec.innerHTML = `<h4 style="margin:22px 0 4px">Webhooks</h4>
    <p class="muted small" style="margin:0 0 8px">Webhooks let other apps and services post into a channel as a BOT. <b>Anyone with a webhook's URL can post as it</b>, so treat the URL like a password - it is shown once, when you create it. Delete a webhook to cut it off.</p>
    <div id="whList"><div class="empty">Loading…</div></div>
    <div class="row" style="margin-top:10px;align-items:flex-end">
      <div><label class="lbl" style="margin-top:0">Channel</label><select class="in" id="whChan">${svCache.chans.map(c => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select></div>
      <div style="flex:1;min-width:160px"><label class="lbl" style="margin-top:0">Name</label><input class="in" id="whName" maxlength="32" placeholder="Build bot" autocomplete="off"></div>
      <button class="btn primary" id="whCreate">Create webhook</button></div>
    <div id="whNew"></div>`;
  host.appendChild(sec);
  const chanName = id => { const c = svCache.chans.find(x => x.id === id); return c ? '#' + c.name : '(deleted channel)'; };
  const draw = async () => {
    const { data, error } = await sb.from('channel_webhooks').select('id,channel_id,name,created_at,last_used_at').eq('server_id', s.id).order('created_at');
    const box = $('whList'); if (!box) return;
    if (error) { box.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    box.innerHTML = data.length ? data.map(w => `<div class="emrow"><span style="flex:1;min-width:0"><b>${esc(w.name)}</b> <span class="botbadge">BOT</span> <span class="muted small">${esc(chanName(w.channel_id))} · created ${esc(new Date(w.created_at).toLocaleDateString())} · ${w.last_used_at ? 'last used ' + esc(new Date(w.last_used_at).toLocaleString()) : 'never used'}</span></span><button class="btn sm danger" data-id="${esc(w.id)}" data-n="${esc(w.name)}">Delete</button></div>`).join('')
      : '<div class="empty">No webhooks yet.</div>';
    box.querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
      if (!confirm(`Delete the webhook "${b.dataset.n}"? Anything still using its URL stops working. Messages it already posted stay.`)) return;
      const r = await sb.from('channel_webhooks').delete().eq('id', b.dataset.id).select('id');
      if (r.error) return fail(r.error);
      draw();
    });
  };
  draw();
  $('whCreate').onclick = async () => {
    const name = $('whName').value.trim(); if (!name) return toast('Give the webhook a name.');
    $('whCreate').disabled = true;
    const { data, error } = await sb.rpc('create_channel_webhook', { cid: $('whChan').value, wname: name });
    if ($('whCreate')) $('whCreate').disabled = false;
    if (error) return fail(error);
    const r = Array.isArray(data) ? data[0] : data; if (!r || !r.secret) return toast('Something went wrong creating the webhook.');
    const url = `${SUPABASE_URL}/functions/v1/channel-webhook/${r.webhook_id}/${r.secret}`;
    $('whName').value = '';
    $('whNew').innerHTML = `<div class="whnew"><b>Copy this URL now - it won't be shown again.</b>
      <p class="small" style="color:var(--err);margin:2px 0 8px">Anyone with this URL can post to #${esc((svCache.chans.find(c => c.id === $('whChan').value) || {}).name || 'the channel')}. Don't share it or paste it anywhere public.</p>
      <div class="row"><input class="in" id="whUrl" readonly style="flex:1;min-width:200px;font-family:ui-monospace,Consolas,monospace;font-size:13px"><button class="btn" id="whCopy">Copy</button></div>
      <p class="muted small" style="margin:8px 0 0">POST JSON like {"content":"hello"} with Content-Type: application/json.</p></div>`;
    $('whUrl').value = url; $('whUrl').onfocus = () => $('whUrl').select();
    $('whCopy').onclick = () => { navigator.clipboard.writeText(url).then(() => toast('Webhook URL copied.'), () => { $('whUrl').select(); toast('Press Ctrl+C to copy.'); }); };
    draw();
  };
}

// ---------------------------------------------------------------- shared chat pane (channels, DMs, groups, projects)
// o.table, when set to one of 'messages' | 'group_messages' | 'channel_messages', turns on reactions/reply/forward
// (the three real message tables per cloud/schema.sql - ai_project_messages doesn't get these, so its caller just
// omits o.table and the pane behaves exactly as before).
function chatPane(pane, o) {
  const reactable = o.table && REACTABLE_TABLES.has(o.table);  // the same three tables are the ones with attachments
  const reportTable = o.reportTable || (reactable ? o.table : null);  // any of the 4 message tables can be reported
  pane.innerHTML = `<div class="head">${o.onBack ? '<button type="button" class="btn sm mob-back" id="paneBack" title="Back to list">← Back</button>' : ''}${o.title}<span class="sp"></span>${reactable && o.pinContext ? '<button type="button" class="btn sm" id="pinsBtn" title="Pinned messages">📌 Pinned</button>' : ''}${o.headExtra || ''}</div><div class="msgs"></div>
    ${o.readOnly ? '<div class="composer muted small">View only - you can read this project but not post. Ask an editor for Edit access.</div>' : ''}<div class="composer"${o.readOnly ? ' hidden' : ''}>${reactable ? '<div class="replybar" id="replyBar" hidden></div>' : ''}<form autocomplete="off"><button type="button" class="emo" title="Emoji">😊</button><button type="button" class="mic" title="Voice input" hidden>🎤</button>
    <input maxlength="2000" placeholder="${esc(o.placeholder || 'Message')}"${o.readOnly ? ' disabled' : ''}><button class="btn primary sm">Send</button></form></div>`;
  if (o.onBack) pane.querySelector('#paneBack').onclick = o.onBack;
  const box = pane.querySelector('.msgs'), input = pane.querySelector('input'), seen = new Set();
  const byId = new Map(), reactions = new Map();  // reactable only: id -> row, id -> Map(emoji -> Set(user_id))
  let last = null, replyTo = null, live = false;
  // ---- pins: o.pinContext is the conversation key (pinned_messages.context_id), o.canPin whether I may pin/unpin here
  const pins = new Set(), pinnable = !!(reactable && o.pinContext && o.canPin);
  const markPinned = (el, id) => { el.classList.toggle('pinned', pins.has(id)); const b = el.querySelector('.act-pin'); if (b) b.title = pins.has(id) ? 'Unpin' : 'Pin'; };
  async function togglePin(m, el) {
    const was = pins.has(m.id);
    const { data, error } = was ? await sb.from('pinned_messages').delete().eq('message_table', o.table).eq('message_id', m.id).select()
      : await sb.from('pinned_messages').insert({ message_table: o.table, message_id: m.id, pinned_by: me.id }).select();
    if (error) return fail(error);
    if (!data || !data.length) return toast("You can't change pins here.");
    if (was) pins.delete(m.id); else pins.add(m.id);
    markPinned(el, m.id); toast(was ? 'Message unpinned' : 'Message pinned');
  }
  async function openPins() {
    const old = pane.querySelector('.pinpanel'); if (old) return old.remove();
    const panel = document.createElement('div'); panel.className = 'pinpanel';
    panel.innerHTML = '<div class="pinhead"><b>📌 Pinned messages</b><button type="button" class="btn sm" data-x>✕</button></div><div class="pinlist"><div class="empty">Loading…</div></div>';
    pane.appendChild(panel); panel.querySelector('[data-x]').onclick = () => panel.remove();
    const list = panel.querySelector('.pinlist');
    try {
      const { data: pr, error } = await sb.from('pinned_messages').select('message_id,created_at').eq('context_id', o.pinContext).order('created_at', { ascending: false });
      if (error) throw error;
      if (!pr.length) { list.innerHTML = '<div class="empty">Nothing pinned yet. Use 📌 on a message to pin it.</div>'; return; }
      const { data: ms, error: e2 } = await sb.from(o.table).select('*').in('id', pr.map(r => r.message_id));
      if (e2) throw e2;
      await getProfiles(ms.map(m => m.sender));
      const byM = new Map(ms.map(m => [m.id, m]));
      list.innerHTML = '';
      pr.forEach(r => {
        const m = byM.get(r.message_id); if (!m || isHidden(m.sender)) return;
        const it = document.createElement('div'); it.className = 'pinitem';
        it.innerHTML = `<div class="small muted"><b>${esc(dname(profiles.get(m.sender)))}</b> · ${esc(new Date(m.created_at).toLocaleString())}</div>
          <div class="pinbody">${esc((actAtt(m) ? '🎮 ' : '') + ((m.body || (m.attachments ? '📎 Attachment' : '')).slice(0, 220)))}</div>
          <div class="row"><button type="button" class="btn sm" data-j>Jump to message</button>${pinnable ? '<button type="button" class="btn sm" data-u>Unpin</button>' : ''}</div>`;
        it.querySelector('[data-j]').onclick = () => {
          const t = box.querySelector(`[data-mid="${m.id}"]`);
          if (!t) return toast("That message is older than what's loaded here.");
          panel.remove(); t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600);
        };
        const u = it.querySelector('[data-u]');
        if (u) u.onclick = async () => {
          const { data, error } = await sb.from('pinned_messages').delete().eq('message_table', o.table).eq('message_id', m.id).select();
          if (error) return fail(error); if (!data || !data.length) return toast("You can't change pins here.");
          pins.delete(m.id); it.remove(); const el = box.querySelector(`[data-mid="${m.id}"]`); if (el) markPinned(el, m.id);
          if (!list.children.length) list.innerHTML = '<div class="empty">Nothing pinned yet.</div>';
        };
        list.appendChild(it);
      });
      if (!list.children.length) list.innerHTML = '<div class="empty">Nothing visible is pinned.</div>';
    } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
  }
  if (reactable && o.pinContext) {
    pane.querySelector('#pinsBtn').onclick = openPins;
    sb.from('pinned_messages').select('message_id').eq('context_id', o.pinContext).then(({ data }) => {
      (data || []).forEach(r => pins.add(r.message_id));
      box.querySelectorAll('[data-mid]').forEach(el => markPinned(el, Number(el.dataset.mid)));
    });
  }

  function setReplyTo(m) {
    replyTo = m;
    const bar = pane.querySelector('#replyBar'); if (!bar) return;
    if (!m) { bar.hidden = true; bar.innerHTML = ''; return; }
    const p = m.sender ? profiles.get(m.sender) : null;
    bar.hidden = false;
    bar.innerHTML = `Replying to <b>${esc(m.webhook_name || (m.sender === me.id ? 'yourself' : dname(p)))}</b>: ${esc((m.body || '').slice(0, 60))}<button type="button" class="btn sm" id="replyCancel">✕</button>`;
    bar.querySelector('#replyCancel').onclick = () => setReplyTo(null);
  }
  function reactPillsHtml(id) {
    const em = reactions.get(id); if (!em || !em.size) return '';
    return `<div class="reacts">${[...em].map(([e, s]) => `<button type="button" class="react${s.has(me.id) ? ' mine' : ''}" data-e="${esc(e)}">${e} ${s.size}</button>`).join('')}</div>`;
  }
  function replyQuoteHtml(m) {
    if (!m.reply_to) return '';
    const orig = byId.get(m.reply_to);
    if (!orig) return `<div class="quote" data-goto="${m.reply_to}">↩ replying to a message</div>`;
    const p = orig.sender ? profiles.get(orig.sender) : null;
    return `<div class="quote" data-goto="${m.reply_to}">↩ <b>${esc(orig.webhook_name || (orig.sender === me.id ? 'you' : dname(p)))}</b>: ${esc((orig.body || (orig.attachments ? '📎 Attachment' : '')).slice(0, 80))}</div>`;
  }
  async function toggleReaction(id, emoji) {
    const { data } = await sb.from('message_reactions').select('id').eq('message_table', o.table).eq('message_id', id).eq('user_id', me.id).eq('emoji', emoji).maybeSingle();
    const err = data ? (await sb.from('message_reactions').delete().eq('id', data.id)).error
      : (await sb.from('message_reactions').insert({ message_table: o.table, message_id: id, user_id: me.id, emoji })).error;
    if (err) fail(err);
  }
  function applyReactionEvent(type, r) {
    if (!byId.has(r.message_id)) return;
    if (type === 'DELETE') { const em = reactions.get(r.message_id); if (em) { const s = em.get(r.emoji); if (s) { s.delete(r.user_id); if (!s.size) em.delete(r.emoji); } } }
    else { if (!reactions.has(r.message_id)) reactions.set(r.message_id, new Map()); const em = reactions.get(r.message_id); if (!em.has(r.emoji)) em.set(r.emoji, new Set()); em.get(r.emoji).add(r.user_id); }
    const el = box.querySelector(`[data-mid="${r.message_id}"]`); if (el) { const rp = el.querySelector('.reacts'); const html = reactPillsHtml(r.message_id); if (rp) rp.outerHTML = html; else if (html) (el.querySelector('.attlist') || el.querySelector('.body')).insertAdjacentHTML('afterend', html); wireReactPills(el, r.message_id); }
  }
  function wireReactPills(el, id) {
    el.querySelectorAll('.react').forEach(b => b.onclick = () => toggleReaction(id, b.dataset.e));
  }
  const bodyHtml = x => renderBody(x.body, o.emojis && o.emojis()) + editedTag(x);
  // Inline editor: Enter saves, Shift+Enter = new line, Esc cancels.
  function startEdit(el, m) {
    const bodyEl = el.querySelector('.body'); if (!bodyEl || el.querySelector('.editbox')) return;
    const box2 = document.createElement('div'); box2.className = 'editbox';
    const ta = document.createElement('textarea'); ta.className = 'in'; ta.maxLength = 2000; ta.rows = Math.min(6, Math.max(2, m.body.split('\n').length)); ta.value = m.body;
    const hint = document.createElement('div'); hint.className = 'small muted'; hint.textContent = 'Enter to save · Shift+Enter for a new line · Esc to cancel';
    box2.append(ta, hint); bodyEl.style.display = 'none'; bodyEl.after(box2);
    const close = () => { box2.remove(); bodyEl.style.display = ''; };
    let busy = false;
    const save = async () => {
      if (busy) return;
      const v = ta.value.trim();
      if (v === m.body) return close();
      if (!v && !(Array.isArray(m.attachments) && m.attachments.length)) return toast("A message can't be empty - delete it instead.");
      busy = true; ta.disabled = true;
      const { data, error } = await sb.from(o.table).update({ body: v }).eq('id', m.id).select('id, body, edited_at');
      busy = false; ta.disabled = false;
      if (error) { ta.focus(); return fail(error); }
      close();
      if (!data || !data.length) return toast("You can't edit this message any more (edits are allowed for 24 hours).");
      Object.assign(m, data[0]); bodyEl.innerHTML = bodyHtml(m);
    };
    ta.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    };
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  async function deleteMsg(el, m) {
    const mine = m.sender === me.id;
    if (!confirm(`Delete this message? ${mine ? 'It is removed for everyone in this conversation.' : 'You are deleting it as a moderator - it is removed for everyone.'} This can't be undone.`)) return;
    const { data, error } = await sb.from(o.table).delete().eq('id', m.id).select('id');
    if (error) return fail(error);
    if (!data || !data.length) return toast("Couldn't delete that message.");
    el.remove();
  }
  function applyEdit(u) {   // realtime UPDATE (an edit from the sender, or from their other window)
    const m0 = byId.get(u.id); if (!m0) return;
    m0.body = u.body; m0.edited_at = u.edited_at;
    const el = box.querySelector(`[data-mid="${u.id}"]`), b = el && el.querySelector('.body'); if (b) b.innerHTML = bodyHtml(m0);
  }
  function applyDelete(id) { byId.delete(id); const el = box.querySelector(`[data-mid="${id}"]`); if (el) el.remove(); }
  const add = async m => {
    if (seen.has(m.id)) return; seen.add(m.id);
    const bot = !!m.webhook_name;   // webhook post: shown as BOT with the webhook's name, never as the server owner it is stored under
    if (m.sender && !bot && isHidden(m.sender)) return;  // blocked or muted: hidden client-side only
    byId.set(m.id, m);
    if (m.sender && !bot) await getProfiles([m.sender]);
    const p = m.sender && !bot ? profiles.get(m.sender) : null;
    const cont = last && authorKey(last) === authorKey(m) && new Date(m.created_at) - new Date(last.created_at) < 5 * 60e3;
    const el = document.createElement('div'); el.className = 'msg' + (cont ? ' cont' : '') + (m.sender ? '' : ' ai'); el.dataset.mid = m.id;
    const who = bot ? `<span class="name">${esc(m.webhook_name)}</span><span class="botbadge">BOT</span>` : m.sender ? nameHtml(p, o.roleOf ? o.roleOf(m.sender) : null) : `<span class="name">AI</span>${m.model ? ` <span class="muted small">${esc(m.model)}</span>` : ''}`;
    const canReport = !!(reportTable && m.sender && me && m.sender !== me.id);
    const canEditM = !!(reactable && me && m.sender === me.id && !bot && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS && !actAtt(m));
    const canDelM = !!(reactable && me && (m.sender === me.id || (o.canDelete && o.canDelete(m))));
    const acts = (reactable || canReport) ? `<span class="msgacts">${reactable ? `
        <button type="button" class="btn sm act-react" title="Add reaction">😊</button>
        <button type="button" class="btn sm act-reply" title="Reply">↩</button>
        <button type="button" class="btn sm act-fwd" title="Forward">➦</button>` : ''}${pinnable ? '<button type="button" class="btn sm act-pin" title="Pin">📌</button>' : ''}${canEditM ? '<button type="button" class="btn sm act-edit" title="Edit message">✎</button>' : ''}${canDelM ? '<button type="button" class="btn sm act-del" title="Delete message">🗑</button>' : ''}${canReport ? '<button type="button" class="btn sm act-report" title="Report">⚑</button>' : ''}
      </span>` : '';
    el.innerHTML = `${bot ? '<span class="av botav">🤖</span>' : m.sender ? avatar(p, '', o.roleOf ? o.roleOf(m.sender) : null) : '<span class="av">✦</span>'}<div style="min-width:0;flex:1">${cont ? '' : `<div class="meta">${who}<time>${new Date(m.created_at).toLocaleString()}</time></div>`}
      ${m.forwarded_from_name ? `<div class="quote fwd">➦ Forwarded from <b>${esc(m.forwarded_from_name)}</b></div>` : ''}
      ${reactable ? replyQuoteHtml(m) : ''}
      <div class="body">${bodyHtml(m)}</div>${embedHtml(m)}${reactable ? reactPillsHtml(m.id) : ''}</div>${acts}${!reactable && o.canDelete && o.canDelete(m) ? '<button class="btn sm del" title="Delete">🗑</button>' : ''}`;
    if (reactable) { attMount(el, m); actMount(el, m, o.table); }
    if (pinnable) { markPinned(el, m.id); el.querySelector('.act-pin').onclick = () => togglePin(m, el); }
    if (live && m.sender !== me.id) { const ia = actAtt(m); if (ia && Array.isArray(ia.invited) && ia.invited.includes(me.id)) toast(`${dname(p)} invited you to play ${ia.title}`); }
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => { const err = await o.del(m); if (err) fail(err); else el.remove(); };
    const quote = el.querySelector('.quote[data-goto]');
    if (quote) quote.onclick = () => { const t = box.querySelector(`[data-mid="${quote.dataset.goto}"]`); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } };
    if (reactable) {
      wireReactPills(el, m.id);
      el.querySelector('.act-reply').onclick = () => setReplyTo(m);
      el.querySelector('.act-react').onclick = e => showReactPicker(e, id => toggleReaction(m.id, id));
      el.querySelector('.act-fwd').onclick = e => showForwardPicker(e, Object.assign(m, { __tbl: o.table }), bot ? { display_name: m.webhook_name } : p);
    }
    if (canReport) el.querySelector('.act-report').onclick = () => openReport(reportTable, m);
    { const eb = el.querySelector('.act-edit'); if (eb) eb.onclick = () => startEdit(el, m); const db = el.querySelector('.act-del'); if (db) db.onclick = () => deleteMsg(el, m); }
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (box.querySelector('.empty')) box.innerHTML = '';
    box.appendChild(el); last = m;
    if (stick) box.scrollTop = box.scrollHeight;
  };
  (async () => {
    box.innerHTML = '<div class="empty">Loading…</div>';
    const rows = await o.load();
    box.innerHTML = rows.length ? '' : `<div class="empty">${esc(o.emptyText || 'No messages yet - say hi 👋')}</div>`;
    await getProfiles(rows.map(r => r.sender));
    for (const r of rows) await add(r);
    box.scrollTop = box.scrollHeight;
    live = true;
    if (pendingJump && pendingJump.table === o.table) {
      const pj = pendingJump; pendingJump = null;
      const t = box.querySelector(`[data-mid="${pj.id}"]`);
      if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1800); }
      else toast('Opened the conversation - that message is further back than what is loaded.');
    }
    if (reactable && rows.length) {
      const { data } = await sb.from('message_reactions').select('*').eq('message_table', o.table).in('message_id', rows.map(r => r.id));
      (data || []).forEach(r => applyReactionEvent('INSERT', r));
      const rch = sb.channel('reacts:' + o.table + ':' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `message_table=eq.${o.table}` },
          payload => applyReactionEvent(payload.eventType, payload.new || payload.old)).subscribe();
      pageSubs.push(() => sb.removeChannel(rch));
    }
  })().catch(fail);
  const ch = o.subscribe(add);
  if (ch) pageSubs.push(() => sb.removeChannel(ch));
  if (reactable) {   // edits and deletes by other people (DELETE events can't be filtered; the id is matched against what is rendered)
    const ech = sb.channel('edits:' + o.table + ':' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: o.table }, ({ new: u }) => { if (u) applyEdit(u); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: o.table }, ({ old: r }) => { if (r) applyDelete(r.id); }).subscribe();
    pageSubs.push(() => sb.removeChannel(ech));
  }
  pane.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const body = input.value.trim(); if ((!body && !(att && att.count())) || (att && att.busy)) return;
    input.value = '';
    const rt = replyTo; if (reactable) setReplyTo(null);
    const err = att ? (await attSend(att, atts => o.send(body, rt ? rt.id : undefined, atts).then(error => ({ error })))).error : await o.send(body, rt ? rt.id : undefined);
    if (err) { fail(err); input.value = body; if (reactable) setReplyTo(rt); }
  };
  let att = null;
  if (reactable) att = attComposer(pane.querySelector('form'), input, { sched: o.schedTarget ? { table: o.table, target: o.schedTarget } : null, onGif: async g => {
    const err = await o.send('', replyTo ? replyTo.id : undefined, [g]);
    if (err) fail(err); else setReplyTo(null);
  }, onActivity: o.activity ? () => {
    const invitees = o.activity();
    if (!invitees.length) return toast('There is no one else to invite here yet.');
    actDialog({ invitees, fixed: o.table === 'messages', send: a => o.send('🎮 ' + a.title, undefined, [a]) });
  } : null });
  pane.querySelector('.emo').onclick = e => {
    e.stopPropagation();
    let pk = pane.querySelector('.picker');
    if (pk) return pk.remove();
    pk = document.createElement('div'); pk.className = 'picker';
    const std = Object.entries(EMOJI).map(([k, v]) => `<button type="button" title=":${k}:" data-k="${k}">${v}</button>`).join('');
    const custom = o.emojis ? o.emojis() : null;   // server channels only: Map name -> image url
    if (custom) {
      const cust = custom.size ? [...custom].map(([k, u]) => `<button type="button" title=":${k}:" data-k="${k}"><img class="cemoji big" src="${esc(u)}" alt=":${k}:"></button>`).join('') : '<div class="empty" style="grid-column:1/-1">This server has no custom emoji yet. Admins can add some in server settings.</div>';
      pk.innerHTML = `<div class="ptabs"><button type="button" data-tab="std" class="on">Standard</button><button type="button" data-tab="srv">Server</button></div><div class="pgrid" data-pane="std">${std}</div><div class="pgrid" data-pane="srv" hidden>${cust}</div>`;
    } else pk.innerHTML = std;
    pk.onclick = ev => {
      const tab = ev.target.closest('[data-tab]');
      if (tab) { pk.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === tab)); pk.querySelectorAll('[data-pane]').forEach(d => { d.hidden = d.dataset.pane !== tab.dataset.tab; }); return; }
      const k = ev.target.closest('button')?.dataset.k; if (k) { input.value += `:${k}: `; input.focus(); }
    };
    pane.querySelector('.composer').appendChild(pk);
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }));
  };
  attachMic(pane.querySelector('.mic'), () => input);
  setTimeout(() => input.focus());
}
const subscribeTable = (name, table, filter, onRow) => sb.channel(name + ':' + Math.random().toString(36).slice(2))
  .on('postgres_changes', Object.assign({ event: 'INSERT', schema: 'public', table }, filter ? { filter } : {}), ({ new: m }) => onRow(m)).subscribe();

// ---------------------------------------------------------------- chat attachments (DMs, group chats, server channels)
// Files go to the PRIVATE `chat-media` bucket at '{my uid}/{uuid}-{name}' and are referenced from the message's
// `attachments` jsonb ([{path,name,type,size}] or {kind:'gif',url,title}). They are only ever viewed through
// getAttachmentUrl() below (short-lived signed URLs) - that is the single choke point for viewing/downloading.
// Per-message total limit in MB. Supabase Free caps every upload at 50 MB project-wide, so both are 50 today;
// raise `plus` to 300 once the Supabase plan/global upload limit allows it (and see chat_media_limit_bytes() in
// cloud/schema.sql, which enforces the same numbers server-side; ui.html has the same constant).
const ATTACH_LIMIT_MB = { free: 50, plus: 50 };
const ATTACH_MAX_FILES = 10;
const attLimitBytes = () => (isPlus(myProfile) ? ATTACH_LIMIT_MB.plus : ATTACH_LIMIT_MB.free) * 1048576;
function attFmt(b) { b = Number(b) || 0; return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
// Fixed mime allowlists decide how an attachment is rendered; anything else is a download-only file chip.
function attKind(type) {
  type = String(type || '').toLowerCase();
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(type)) return 'image';
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(type)) return 'video';
  if (/^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|flac|aac|mp4|x-m4a|m4a)$/.test(type)) return 'audio';
  return 'file';
}
const attDisplayName = n => (String(n || 'file').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(-120)) || 'file';
const attPathName = n => (attDisplayName(n).replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.').slice(-80)) || 'file';
const attGifOk = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)(giphy\.com|giphyusercontent\.com)$/.test(x.hostname); } catch (e) { return false; } };

// ---- upload scanning (cloud/supabase/functions/scan-attachment). Files are checked for known malware signatures
// (hash list + EICAR), disguised executables and zip bombs. That is NOT a full antivirus and the UI must not claim it is.
const attScanCache = new Map();              // path -> { status: 'clean'|'quarantined', reason }  (final verdicts only)
const attSleep = ms => new Promise(r => setTimeout(r, ms));
async function attScanRun(path) {            // ask the scanner; idempotent - returns the stored verdict if there already is one
  const { data, error } = await sb.functions.invoke('scan-attachment', { body: { path } });
  if (error) throw new Error(error.message || 'scanner unavailable');
  if (data && (data.status === 'clean' || data.status === 'quarantined')) attScanCache.set(path, { status: data.status, reason: data.reason || '' });
  return data || { status: 'error' };
}
// Verdict for a path: reads attachment_scans (RLS: only for files I can read); if there is none (or the last scan errored)
// it asks the scanner once; while a scan is pending it retries a bounded number of times, then reports 'pending'.
async function attScan(path, tries) {
  const hit = attScanCache.get(path); if (hit) return hit;
  let asked = false, last = 'pending';
  for (let i = 0; i < (tries || 6); i++) {
    const { data } = await sb.from('attachment_scans').select('status,reason').eq('path', path).maybeSingle();
    if (data) last = data.status;
    if (data && (data.status === 'clean' || data.status === 'quarantined')) { const v = { status: data.status, reason: data.reason || '' }; attScanCache.set(path, v); return v; }
    if ((!data || data.status === 'error') && !asked) {
      asked = true;
      try { await attScanRun(path); const c = attScanCache.get(path); if (c) return c; } catch (e) { last = 'error'; }
    }
    await attSleep(1500);
  }
  return { status: last, reason: '' };
}
const attBlockedErr = s => Object.assign(new Error(s.reason || 'flagged as unsafe'), { blocked: true });

// ---- the one choke point for viewing/downloading any attachment
const attUrlCache = new Map();               // key -> { url, exp }
async function getAttachmentUrl(att, opts) {
  if (att && att.kind === 'gif') { if (attGifOk(att.url)) return att.url; throw new Error('Blocked gif source'); }
  if (!att || typeof att.path !== 'string') throw new Error('Bad attachment');
  const dl = !!(opts && opts.download), key = att.path + (dl ? '|dl' : '');
  const hit = attUrlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const sc = await attScan(att.path);                  // scan gate: nothing is served unless the scanner passed it
  if (sc.status === 'quarantined') throw attBlockedErr(sc);
  if (sc.status !== 'clean') throw Object.assign(new Error(sc.status === 'error' ? "couldn't be scanned" : 'still being scanned - try again in a moment'), { scanning: true });
  const { data, error } = await sb.storage.from('chat-media').createSignedUrl(att.path, 3600, dl ? { download: attDisplayName(att.name) } : undefined);
  if (error || !data) throw new Error(error ? error.message : 'No URL');
  attUrlCache.set(key, { url: data.signedUrl, exp: Date.now() + 50 * 60e3 });
  return data.signedUrl;
}

function attLightbox(att) {
  getAttachmentUrl(att).then(url => {
    const box = document.createElement('div'); box.className = 'attlightbox';
    const img = document.createElement('img'); img.src = url; img.alt = '';
    box.appendChild(img);
    const close = () => { box.remove(); document.removeEventListener('keydown', esc2); };
    const esc2 = ev => { if (ev.key === 'Escape') close(); };
    box.onclick = close; document.addEventListener('keydown', esc2);
    document.body.appendChild(box);
  }).catch(() => toast("Couldn't open that image."));
}
function attRender(atts) {
  if (!Array.isArray(atts) || !atts.length) return null;
  const list = document.createElement('div'); list.className = 'attlist';
  const gone = (el, e) => { const s = document.createElement('span'); s.className = 'attgone'; s.textContent = e && e.blocked ? 'Blocked by scanner: ' + e.message : e && e.scanning ? 'Scanning... (' + e.message + ')' : 'Attachment unavailable'; el.replaceWith(s); };
  atts.slice(0, 10).forEach(att => {
    if (!att || typeof att !== 'object') return;
    const name = attDisplayName(att.name);
    if (att.kind === 'gif') {
      if (!attGifOk(att.url)) return;
      const img = document.createElement('img'); img.className = 'attimg gif'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.alt = String(att.title || 'GIF').slice(0, 100); img.src = att.url; img.onclick = () => attLightbox(att); img.onerror = () => gone(img);
      list.appendChild(img); return;
    }
    if (typeof att.path !== 'string') return;
    const kind = attKind(att.type);
    if (kind === 'image') {
      const img = document.createElement('img'); img.className = 'attimg'; img.loading = 'lazy'; img.alt = name;
      img.onclick = () => attLightbox(att); img.onerror = () => gone(img); list.appendChild(img);
      getAttachmentUrl(att).then(u => { img.src = u; }).catch(e => gone(img, e));
    } else if (kind === 'video' || kind === 'audio') {
      const v = document.createElement(kind); v.controls = true; v.preload = kind === 'video' ? 'metadata' : 'none'; v.onerror = () => gone(v); list.appendChild(v);
      getAttachmentUrl(att).then(u => { v.src = u; }).catch(e => gone(v, e));
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'attfile'; b.title = 'Download';
      const n = document.createElement('span'); n.textContent = '📎 ' + name; const sz = document.createElement('small'); sz.textContent = attFmt(att.size);
      b.append(n, sz);
      b.onclick = async () => { try { const u = await getAttachmentUrl(att, { download: true }); window.open(u, '_blank', 'noopener'); } catch (e) { toast("Couldn't download that file: " + e.message); } };
      const note = document.createElement('small'); note.className = 'attnote'; b.appendChild(note); list.appendChild(b);
      attScan(att.path).then(sc => {
        if (sc.status === 'quarantined') { const s = document.createElement('span'); s.className = 'attgone'; s.textContent = 'Blocked by scanner: ' + (sc.reason || 'flagged as unsafe'); b.replaceWith(s); }
        else if (sc.status === 'clean' && sc.reason) { note.textContent = '\u26a0 ' + sc.reason; note.title = sc.reason; note.classList.add('warn'); }
        else if (sc.status !== 'clean') note.textContent = sc.status === 'error' ? 'not scanned' : 'Scanning...';
      }).catch(() => {});
    }
  });
  return list.childNodes.length ? list : null;
}
// Adds a message's attachments under its body (and hides the empty body of an attachment-only message).
function attMount(el, m) {
  const list = attRender(m.attachments);
  const body = el.querySelector('.body');
  if (!list || !body) return;
  if (!m.body) body.hidden = true;
  body.after(list);
}

// ---- composer: paperclip + GIF button, pending tray, drag/drop, paste, upload with progress
function attStorageError(x) {
  let msg = ''; try { msg = (JSON.parse(x.responseText).message) || ''; } catch (e) {}
  if (x.status === 413 || /exceed|too large|maximum allowed/i.test(msg)) return "Storage rejected the file as too large - the server's upload limit is lower than the message limit.";
  return msg || ('Upload failed (' + x.status + ')');
}
// ---- upload quotas + de-duplication. Per user: 60 MB / 24 h, 700 MB / 30 days, 5 GB stored (numbers live in the database,
// chat_media_quota_limits()). A file is stored under the SHA-256 of its contents, so sending the same file again reuses the
// stored copy: nothing is uploaded and no quota is used.
const attFresh = new Set();                 // paths this session uploaded for a send that hasn't completed yet (only these may be discarded)
let attQuotaCache = null;
async function attQuota(force) {
  if (!force && attQuotaCache && Date.now() - attQuotaCache.at < 15000) return attQuotaCache.q;
  try { const { data } = await sb.rpc('upload_quota'); attQuotaCache = { at: Date.now(), q: data || null }; return data || null; } catch (e) { return null; }
}
const attMB = b => (Number(b) >= 1073741824 ? (Number(b) / 1073741824).toFixed(1) + ' GB' : Math.max(0, Math.round(Number(b) / 1048576)) + ' MB');
function attQuotaProblem(q, bytes) {        // a sentence explaining why this upload can't go ahead, or null
  if (!q || q.unlimited) return null;
  const left = k => (q[k] ? q[k].limit - q[k].used : Infinity);
  if (bytes > left('total')) return `Storage full: you've used ${attMB(q.total.used)} of your ${attMB(q.total.limit)}. Delete some of your files to upload more.`;
  if (bytes > left('month')) return `That would go over your monthly upload limit (${attMB(q.month.limit)} per 30 days, ${attMB(Math.max(0, left('month')))} left).`;
  if (bytes > left('day')) return `That would go over your daily upload limit (${attMB(q.day.limit)} per 24 hours, ${attMB(Math.max(0, left('day')))} left).`;
  return null;
}
async function attHash(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
async function attUploadOne(item, onProgress) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Signed out');
  const hash = await attHash(item.file);
  const ext = ((/\.[A-Za-z0-9]{1,8}$/.exec(item.file.name) || [''])[0]).toLowerCase();
  const path = `${me.id}/${hash}${ext}`;
  const meta = { path, name: attDisplayName(item.file.name), type: item.file.type || 'application/octet-stream', size: item.file.size };
  // Already stored from an earlier send? Then there's nothing to upload (and nothing to count against the quota).
  const { data: have } = await sb.storage.from('chat-media').list(me.id, { search: hash, limit: 5 });
  if ((have || []).some(o => o.name === hash + ext)) { onProgress(1); return meta; }
  const bad = attQuotaProblem(await attQuota(true), item.file.size);
  if (bad) throw new Error(bad);
  let fresh = false;
  await new Promise((res, rej) => {
    const x = new XMLHttpRequest(); item.xhr = x;
    x.open('POST', `${SUPABASE_URL}/storage/v1/object/chat-media/${path.split('/').map(encodeURIComponent).join('/')}`);
    x.setRequestHeader('Authorization', 'Bearer ' + session.access_token); x.setRequestHeader('apikey', SUPABASE_KEY);
    x.setRequestHeader('x-upsert', 'false'); x.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? (fresh = true, res()) : x.status === 409 ? res() : rej(new Error(attStorageError(x))));   // 409: an identical file appeared meanwhile - same thing
    x.onerror = () => rej(new Error('Network error while uploading'));
    x.onabort = () => rej(Object.assign(new Error('Upload cancelled'), { cancelled: true }));
    x.send(item.file);
  });
  if (fresh) attFresh.add(path);
  attQuotaCache = null;
  return meta;
}
function attComposer(form, input, opts) {
  const ctl = { items: [], busy: false, done: [] };
  const tray = document.createElement('div'); tray.className = 'atttray'; form.before(tray);
  const fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true; fi.hidden = true; form.appendChild(fi);
  const clip = document.createElement('button'); clip.type = 'button'; clip.className = 'attbtn'; clip.title = 'Attach files'; clip.textContent = '📎';
  const gifBtn = document.createElement('button'); gifBtn.type = 'button'; gifBtn.className = 'attbtn gifbtn'; gifBtn.title = 'Send a GIF'; gifBtn.textContent = 'GIF';
  input.after(clip); form.querySelector('.emo').after(gifBtn);
  if (opts.onActivity) {
    const actBtn = document.createElement('button'); actBtn.type = 'button'; actBtn.className = 'attbtn'; actBtn.title = 'Start an activity - invite people to play something'; actBtn.textContent = '🎮';
    gifBtn.after(actBtn); actBtn.onclick = e => { e.stopPropagation(); opts.onActivity(); };
  }
  if (opts.sched) {
    const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'attbtn'; cb.title = 'Schedule send'; cb.textContent = '🕒';
    form.querySelector('button.primary').before(cb);
    cb.onclick = e => {
      e.stopPropagation();
      if (ctl.count()) return toast('Scheduled messages are text only for now - remove the attachments first.');
      schedOpen(cb, { table: opts.sched.table, target: opts.sched.target, getText: () => input.value.trim(), onScheduled: () => { input.value = ''; } });
    };
  }
  ctl.total = () => ctl.items.reduce((a, i) => a + i.file.size, 0);
  ctl.count = () => ctl.items.length;
  const draw = () => {
    tray.textContent = '';
    if (!ctl.items.length) return;
    const tot = document.createElement('div'); tot.className = 'atttotal' + (ctl.total() > attLimitBytes() ? ' over' : '');
    tot.textContent = `${attFmt(ctl.total())} / ${attLimitBytes() / 1048576} MB`; tray.appendChild(tot);
    const sn = document.createElement('div'); sn.className = 'attscan'; sn.textContent = 'Scanned for known malware signatures and zip bombs (not a full antivirus)'; tray.appendChild(sn);
    ctl.items.forEach(it => {
      const row = document.createElement('div'); row.className = 'attitem';
      const n = document.createElement('span'); n.className = 'attn'; n.textContent = '📎 ' + attDisplayName(it.file.name) + ' (' + attFmt(it.file.size) + ')';
      const bar = document.createElement('div'); bar.className = 'attbar'; const fill = document.createElement('i'); fill.style.width = Math.round((it.progress || 0) * 100) + '%'; bar.appendChild(fill);
      const x = document.createElement('button'); x.type = 'button'; x.className = 'btn sm'; x.title = ctl.busy ? 'Cancel upload' : 'Remove'; x.textContent = '✕';
      x.onclick = () => { if (ctl.busy) { if (it.xhr) it.xhr.abort(); return; } ctl.items = ctl.items.filter(y => y !== it); draw(); };
      it.fill = fill; row.append(n, bar, x); tray.appendChild(row);
    });
  };
  ctl.add = files => {
    for (const f of Array.from(files)) {
      if (ctl.busy) return toast('Wait for the upload to finish.');
      if (ctl.items.length >= ATTACH_MAX_FILES) return toast(`At most ${ATTACH_MAX_FILES} files per message.`);
      if (!f.size) { toast(`"${attDisplayName(f.name)}" is empty.`); continue; }
      if (ctl.total() + f.size > attLimitBytes()) { toast(`Over the limit: ${attFmt(ctl.total() + f.size)} / ${attLimitBytes() / 1048576} MB per message.`); continue; }
      ctl.items.push({ file: f, progress: 0 });
    }
    draw();
  };
  ctl.clear = () => { ctl.items = []; ctl.busy = false; draw(); };
  // Uploads everything (sequentially). Resolves with the attachments array; on any failure removes what was
  // already uploaded and rejects.
  ctl.upload = async () => {
    ctl.busy = true; draw(); const done = [];
    try {
      for (const it of ctl.items) { done.push(await attUploadOne(it, p => { it.progress = p; if (it.fill) it.fill.style.width = Math.round(p * 100) + '%'; })); }
      return done;
    } catch (e) { attDiscard(done); ctl.items.forEach(i => { i.progress = 0; i.xhr = null; }); throw e; }
    finally { ctl.busy = false; draw(); }
  };
  clip.onclick = () => fi.click();
  fi.onchange = () => { ctl.add(fi.files); fi.value = ''; };
  input.addEventListener('paste', ev => { const fl = ev.clipboardData && ev.clipboardData.files; if (fl && fl.length) { ev.preventDefault(); ctl.add(fl); } });
  const zone = form.closest('.composer')?.parentElement || form;
  const hasFiles = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, ev => { if (hasFiles(ev)) { ev.preventDefault(); ev.stopPropagation(); } }));
  zone.addEventListener('drop', ev => { if (hasFiles(ev)) { ev.preventDefault(); ev.stopPropagation(); ctl.add(ev.dataTransfer.files); } });
  gifBtn.onclick = e => { e.stopPropagation(); attGifPicker(gifBtn, gif => opts.onGif && opts.onGif(gif)); };
  return ctl;
}
// Best-effort removal of uploaded objects (failed send / cancelled upload).
function attDiscard(atts) {
  const paths = (atts || []).filter(a => a && a.path && attFresh.has(a.path)).map(a => a.path);
  paths.forEach(x => attFresh.delete(x));
  if (paths.length) sb.storage.from('chat-media').remove(paths).catch(() => {});
}
const attExtra = atts => (atts && atts.length ? { attachments: atts } : {});
// Upload pending files, then run insert(atts) -> { error }. Cleans up orphaned objects if the insert fails.
async function attSend(ctl, insert) {
  let atts = null;
  try { if (ctl.count()) atts = await ctl.upload(); } catch (e) { return { error: e }; }
  if (atts && atts.length) {                 // scan every uploaded file BEFORE the message goes out; any block cancels the whole send
    try {
      for (const a of atts) {
        const r = await attScanRun(a.path);
        if (r.status === 'quarantined') throw Object.assign(new Error(`"${a.name}" was blocked by the scanner: ${r.reason || 'flagged as unsafe'}`), { blocked: true });
        if (r.status === 'over_limit') throw new Error(r.reason || 'Upload limit reached');
        if (r.status !== 'clean') throw new Error(`"${a.name}" could not be scanned - try again`);
      }
    } catch (e) { attDiscard(atts); ctl.items.forEach(i => { i.progress = 0; i.xhr = null; }); return { error: e }; }
  }
  const r = await insert(atts);
  if (r.error) attDiscard(atts); else { (atts || []).forEach(a => attFresh.delete(a.path)); ctl.clear(); }
  return r;
}

// ---- GIF picker (GIPHY through the gif-search Edge Function, so no API key ships in the app)
// Category chips are just curated searches; favourites live in public.gif_favorites so they follow the account everywhere.
const GIF_CATS = [['Trending', ''], ['Reactions', 'reaction'], ['Funny', 'funny'], ['Love', 'love'], ['Happy', 'happy'], ['Sad', 'sad'], ['Angry', 'angry'], ['Celebrate', 'celebrate'], ['Gaming', 'gaming'], ['Anime', 'anime'], ['Memes', 'meme'], ['Animals', 'animals'], ['Sports', 'sports'], ['Movies', 'movie'], ['Food', 'food']];
let gifFavs = null, gifFavsUid = null;
async function gifFavLoad() {
  const uid = me && me.id;
  if (gifFavs && gifFavsUid === uid) return gifFavs;   // a different account (or a signed-out page) never sees another account's list
  const { data, error } = await sb.from('gif_favorites').select('url, preview_url, title').order('created_at', { ascending: false }).limit(200);
  if (error) return [];   // don't remember a failed lookup as "no favourites"
  gifFavsUid = uid; return (gifFavs = data || []);
}
function attGifPicker(anchor, onPick) {
  document.querySelectorAll('.gifpick').forEach(x => x.remove());
  const pk = document.createElement('div'); pk.className = 'gifpick';
  const q = document.createElement('input'); q.placeholder = 'Search GIPHY…'; q.maxLength = 50;
  const cats = document.createElement('div'); cats.className = 'gifcats';
  const grid = document.createElement('div'); grid.className = 'gifgrid';
  const note = document.createElement('div'); note.className = 'gifnote'; note.textContent = 'Powered by GIPHY';
  pk.append(q, cats, grid, note); document.body.appendChild(pk);
  const place = () => {   // right-aligned with the message box, just above it
    const r = anchor.getBoundingClientRect(), box = (anchor.closest('.composer') || anchor).getBoundingClientRect();
    pk.style.left = Math.max(8, Math.min(box.right - pk.offsetWidth, window.innerWidth - pk.offsetWidth - 8)) + 'px'; pk.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
  };
  place();
  let seq = 0, timer = null, mode = 'cat', cat = 0, offset = 0, more = false, busy = false;
  const chips = [['★ Favorites', null]].concat(GIF_CATS).map(([name, term], i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
    b.onclick = () => { q.value = ''; if (term === null) { mode = 'fav'; } else { mode = 'cat'; cat = i - 1; } setActive(); load(true); };
    cats.appendChild(b); return b;
  });
  const setActive = () => chips.forEach((b, i) => b.classList.toggle('on', mode === 'fav' ? i === 0 : mode === 'cat' && i - 1 === cat));
  const tile = (g, isFav) => {
    const t = document.createElement('div'); t.className = 'giftile';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'gifpickbtn'; b.title = String(g.title || '').slice(0, 100);
    const im = document.createElement('img'); im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.alt = b.title; im.src = g.preview_url; b.appendChild(im);
    b.onclick = () => { pk.remove(); onPick({ kind: 'gif', url: g.gif_url || g.url, title: b.title }); };
    const star = document.createElement('button'); star.type = 'button'; star.className = 'gifstar'; star.title = 'Favourite';
    const url = g.gif_url || g.url;
    const paint = () => { const on = (gifFavs || []).some(f => f.url === url); star.textContent = on ? '★' : '☆'; star.classList.toggle('on', on); };
    star.onclick = async ev => {
      ev.stopPropagation(); await gifFavLoad();
      const on = gifFavs.some(f => f.url === url);
      if (on) { const { error: de } = await sb.from('gif_favorites').delete().eq('url', url); if (de) { star.title = 'Could not remove'; return; } gifFavs = gifFavs.filter(f => f.url !== url); if (mode === 'fav') t.remove(); }
      else {
        const { error } = await sb.from('gif_favorites').insert({ url, preview_url: g.preview_url, title: b.title });
        if (error) { star.title = /too many/i.test(error.message) ? 'You can keep up to 200 favourites' : 'Could not save'; return; }
        gifFavs.unshift({ url, preview_url: g.preview_url, title: b.title });
      }
      paint();
    };
    gifFavLoad().then(paint); paint();
    t.append(b, star); return t;
  };
  const load = async reset => {
    const my = ++seq; busy = true;
    if (reset) { offset = 0; more = false; grid.textContent = 'Loading…'; grid.scrollTop = 0; }
    if (mode === 'fav' && !q.value.trim()) {
      const f = await gifFavLoad(); if (my !== seq || !pk.isConnected) return;
      grid.textContent = ''; busy = false;
      if (!f.length) { grid.textContent = 'No favourites yet - tap the ☆ on any GIF to save it here.'; return; }
      f.forEach(g => { if (attGifOk(g.preview_url) && attGifOk(g.url)) grid.appendChild(tile(g, true)); });
      return;
    }
    const term = q.value.trim() || (mode === 'cat' ? GIF_CATS[cat][1] : '');
    const { data, error } = await sb.functions.invoke('gif-search', { body: { q: term, limit: 24, offset } });
    if (my !== seq || !pk.isConnected) return;
    busy = false; if (reset) grid.textContent = '';
    if (error || !data || !Array.isArray(data.results)) { if (reset) grid.textContent = 'GIF search is not available right now.'; return; }
    if (reset && !data.results.length) { grid.textContent = 'No GIFs found.'; return; }
    data.results.forEach(g => { if (attGifOk(g.preview_url) && attGifOk(g.gif_url)) grid.appendChild(tile(g)); });
    offset += data.results.length; more = data.results.length >= 24 && offset < 200;
  };
  grid.addEventListener('scroll', () => { if (more && !busy && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 200) load(false); });
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { mode = q.value.trim() ? 'search' : 'cat'; setActive(); load(true); }, 350); };
  setActive(); load(true); q.focus();
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }));
}


// ---------------------------------------------------------------- activities ("come play X")
// An activity is an ordinary message whose attachments is ONE item {kind:'activity', title, url?, game?, note?, invited:[uuid..],
// expires_at} (validated and rewritten by guard_message_attachments in cloud/schema.sql). RSVPs live in activity_rsvps.
// The link is user-supplied and untrusted: https only, the real host is always shown, and it only opens on a click + confirm.
const ACT_RSVP = new Map();   // "table:id" -> Map(user id -> 'in' | 'out')
const actCards = new Map();   // "table:id" -> { el, m, att, table, seen }
let actSub = null, actTimer = null;
const ACT_DURATIONS = [[30, '30 minutes'], [60, '1 hour'], [120, '2 hours (default)'], [240, '4 hours'], [480, '8 hours'], [1440, '24 hours']];
function actAtt(m) {
  const a = m && Array.isArray(m.attachments) ? m.attachments[0] : null;
  return a && typeof a === 'object' && a.kind === 'activity' && typeof a.title === 'string' ? a : null;
}
// The real host of an https link (punycode for look-alike IDN hosts), or null if it isn't a plain https URL.
function actHost(url) {
  try { const x = new URL(String(url)); return x.protocol === 'https:' && !x.username && !x.password ? x.host : null; } catch (e) { return null; }
}
const actExpired = a => { const t = Date.parse(a.expires_at); return !(t > Date.now()); };
function actLeft(a) {
  const ms = Date.parse(a.expires_at) - Date.now(); if (!(ms > 0)) return 'Expired';
  const m = Math.ceil(ms / 60000); return 'Ends in ' + (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
}
function actDraw(key) {
  const c = actCards.get(key); if (!c) return;
  const a = c.att, host = a.url ? actHost(a.url) : null, expired = actExpired(a);
  const invited = Array.isArray(a.invited) ? a.invited.filter(x => typeof x === 'string') : [];
  const isInvited = !!me && invited.includes(me.id);
  const rs = ACT_RSVP.get(key) || new Map(), mine = me ? rs.get(me.id) : null;
  const names = ids => { const l = ids.map(id => dname(profiles.get(id))); return esc(l.slice(0, 8).join(', ') + (l.length > 8 ? ` +${l.length - 8} more` : '')); };
  const ins = invited.filter(id => rs.get(id) === 'in'), outs = invited.filter(id => rs.get(id) === 'out'), wait = invited.filter(id => !rs.has(id));
  c.el.className = 'actcard' + (isInvited && !expired ? ' invited' : '') + (expired ? ' expired' : '');
  c.el.innerHTML = `<div class="acthead"><span class="acticon">🎮</span><div style="min-width:0"><div class="acttitle">${esc(a.title)}</div>
      <div class="small muted">${a.game ? `<span class="pill">${esc(a.game)}</span> ` : ''}${isInvited && !expired ? '<span class="pill actyou">You\'re invited</span> ' : ''}${esc(actLeft(a))}</div></div></div>
    ${a.note ? `<div class="actnote">${esc(a.note)}</div>` : ''}
    ${a.url ? (host ? `<div class="acthost">Link goes to <b>${esc(host)}</b></div>` : '<div class="acthost warn">Link hidden - it isn\'t a plain https link</div>') : ''}
    <div class="actwho small">${ins.length ? `✅ In: ${names(ins)}<br>` : ''}${outs.length ? `❌ Can't make it: ${names(outs)}<br>` : ''}${wait.length ? `<span class="muted">Waiting on: ${names(wait)}</span>` : ''}</div>
    <div class="row actbtns">${host && !expired ? '<button type="button" class="btn sm primary" data-a="open">Open</button>' : ''}${isInvited && !expired ? `<button type="button" class="btn sm${mine === 'in' ? ' primary' : ''}" data-a="in">I'm in</button><button type="button" class="btn sm${mine === 'out' ? ' primary' : ''}" data-a="out">Can't make it</button>` : ''}</div>`;
  c.el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => b.dataset.a === 'open' ? actOpen(a) : actRsvp(key, b.dataset.a));
}
function actOpen(a) {
  const host = actHost(a.url); if (!host) return toast('That link isn\'t a plain https link.');
  if (!confirm(`Open ${host}?\n\nThis link was shared in chat - only continue if you trust it.\n\n${a.url}`)) return;
  window.open(a.url, '_blank', 'noopener,noreferrer');
}
async function actRsvp(key, status) {
  const c = actCards.get(key); if (!c || !me) return;
  const rs = ACT_RSVP.get(key) || new Map(); ACT_RSVP.set(key, rs);
  const upd = () => sb.from('activity_rsvps').update({ status }).eq('message_table', c.table).eq('message_id', c.m.id).eq('user_id', me.id);
  let error;
  if (rs.has(me.id)) ({ error } = await upd());
  else { ({ error } = await sb.from('activity_rsvps').insert({ message_table: c.table, message_id: c.m.id, user_id: me.id, status })); if (error && error.code === '23505') ({ error } = await upd()); }
  if (error) return fail(error);
  rs.set(me.id, status); actDraw(key);
}
function actEnsureLive() {
  if (actSub) return;
  actSub = sb.channel('actrsvp:' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_rsvps' }, p => {
      const r = p.new && p.new.message_id ? p.new : p.old; if (!r || !r.message_table) return;
      const key = r.message_table + ':' + r.message_id; if (!actCards.has(key)) return;
      const rs = ACT_RSVP.get(key) || new Map(); ACT_RSVP.set(key, rs);
      if (p.eventType === 'DELETE') rs.delete(r.user_id); else rs.set(r.user_id, r.status);
      actDraw(key);
    }).subscribe();
  actTimer = setInterval(() => actCards.forEach((c, k) => { if (c.el.isConnected) { c.seen = true; actDraw(k); } else if (c.seen) actCards.delete(k); }), 30000);
  pageSubs.push(() => { if (actSub) sb.removeChannel(actSub); actSub = null; clearInterval(actTimer); actCards.clear(); });
}
// Replaces the plain "🎮 title" body of an activity message with its card.
function actMount(el, m, table) {
  const a = actAtt(m); if (!a || !table) return;
  const body = el.querySelector('.body'); if (!body) return;
  body.hidden = true;
  const wrap = document.createElement('div'); wrap.className = 'attlist actwrap';
  const card = document.createElement('div'); wrap.appendChild(card); body.after(wrap);
  const key = table + ':' + m.id;
  actCards.set(key, { el: card, m, att: a, table, seen: false });
  actEnsureLive();
  actDraw(key);
  getProfiles([m.sender, ...(Array.isArray(a.invited) ? a.invited : [])]).then(() => actDraw(key)).catch(() => {});
  sb.from('activity_rsvps').select('user_id,status').eq('message_table', table).eq('message_id', m.id).then(({ data }) => {
    const rs = new Map((data || []).map(r => [r.user_id, r.status])); ACT_RSVP.set(key, rs); actDraw(key);
  });
}
// "Start activity" dialog. o.invitees: [{id,name}] people in the conversation (me excluded); o.fixed: DM - the one other person
// is always invited; o.send(att) resolves with an error or null.
function actDialog(o) {
  document.querySelector('.pcard')?.remove();
  const card = document.createElement('div'); card.className = 'pcard';
  card.innerHTML = `<div class="pcard-in" style="padding:20px;max-height:92vh;overflow-y:auto"><h3 style="margin:0 0 4px">🎮 Start an activity</h3>
    <p class="muted small" style="margin:0 0 6px">Ping people to play something. They get an invite they can answer with I'm in / Can't make it.</p>
    <label class="lbl">What are you playing?</label><input class="in" id="acTitle" maxlength="80" placeholder="Bedwars on BlockadeMC">
    <label class="lbl">Game or service (optional)</label><input class="in" id="acGame" maxlength="40" placeholder="Minecraft, Roblox, Discord…">
    <label class="lbl">Link (optional, https only)</label><input class="in" id="acUrl" maxlength="500" placeholder="https://…" inputmode="url" autocomplete="off">
    <label class="lbl">Note (optional)</label><input class="in" id="acNote" maxlength="200" placeholder="Bring a mic">
    <label class="lbl">Lasts</label><select class="in" id="acDur">${ACT_DURATIONS.map(([m, l]) => `<option value="${m}"${m === 120 ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <label class="lbl">Who's invited</label>
    ${o.fixed ? `<div class="small">${esc(o.invitees.map(x => x.name).join(', '))}</div>`
      : `<div class="row small" style="margin-bottom:4px"><button type="button" class="btn sm" id="acAll">Select all (max 25)</button><button type="button" class="btn sm" id="acNone">None</button></div>
         <div style="max-height:160px;overflow-y:auto">${o.invitees.length ? o.invitees.map(x => `<label class="item" style="cursor:pointer"><input type="checkbox" value="${esc(x.id)}"> ${esc(x.name)}</label>`).join('') : '<div class="empty">No one else is here yet.</div>'}</div>`}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="acCancel">Cancel</button><button class="btn primary" id="acSend">Send invite</button></div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  card.querySelector('#acCancel').onclick = () => card.remove();
  const boxes = () => [...card.querySelectorAll('input[type=checkbox]')];
  if (!o.fixed) {
    card.querySelector('#acAll').onclick = () => boxes().forEach((b, i) => { b.checked = i < 25; });
    card.querySelector('#acNone').onclick = () => boxes().forEach(b => { b.checked = false; });
  }
  card.querySelector('#acSend').onclick = async e => {
    const v = id => card.querySelector('#' + id).value.trim();
    const title = v('acTitle'); if (!title) return toast('Give the activity a title.');
    let url = v('acUrl');
    if (url) { const h = actHost(url); if (!h) return toast('The link has to be a plain https:// address.'); }
    const invited = o.fixed ? o.invitees.map(x => x.id) : boxes().filter(b => b.checked).map(b => b.value);
    if (!invited.length) return toast('Pick at least one person to invite.');
    if (invited.length > 25) return toast('You can invite up to 25 people.');
    const att = { kind: 'activity', title, invited, expires_at: new Date(Date.now() + Number(v('acDur')) * 60000).toISOString() };
    if (url) att.url = new URL(url).href; if (v('acGame')) att.game = v('acGame'); if (v('acNote')) att.note = v('acNote');
    e.target.disabled = true;
    const err = await o.send(att);
    if (err) { e.target.disabled = false; return fail(err); }
    card.remove();
  };
  setTimeout(() => card.querySelector('#acTitle').focus());
}

// ---------------------------------------------------------------- pins, global search, directory, server settings
// Pins: rows in pinned_messages (RLS: readable like the message, pin/unpin by DM participants / group members / channel
// moderators+). chatPane() below wires the 📌 button, the hover action and the "Pinned" panel.
let pendingJump = null;   // { table, id } set by a search result; chatPane scrolls to that message once it has loaded
const searchMark = s => esc(s).replace(//g, '<mark>').replace(//g, '</mark>');
function mgSearch() {
  document.querySelector('.pcard')?.remove();
  const card = document.createElement('div'); card.className = 'pcard';
  card.innerHTML = `<div class="pcard-in srchbox"><div style="padding:14px 16px;border-bottom:1px solid var(--border)"><input class="in" id="sqIn" maxlength="100" placeholder="Search messages you can read (DMs, groups, servers)…" autocomplete="off"></div>
    <div id="sqOut" class="srchout"><div class="empty">Type at least 2 characters. Words are matched from the start, e.g. "mine" finds "minecraft".</div></div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  const inp = card.querySelector('#sqIn'), out = card.querySelector('#sqOut'); let timer = null, seq = 0;
  const run = async () => {
    const q = inp.value.trim(); const my = ++seq;
    if (q.length < 2) { out.innerHTML = '<div class="empty">Type at least 2 characters.</div>'; return; }
    out.innerHTML = '<div class="empty">Searching…</div>';
    const { data, error } = await sb.rpc('search_messages', { q, max_results: 30 });
    if (my !== seq) return;
    if (error) { out.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    const rows = (data || []).filter(r => !isHidden(r.sender));
    if (!rows.length) { out.innerHTML = '<div class="empty">No messages found.</div>'; return; }
    const groups = new Map();
    rows.forEach(r => { const k = r.tbl + ':' + r.context_id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    out.innerHTML = '';
    groups.forEach(list => {
      const r0 = list[0], h = document.createElement('div'); h.className = 'srchctx';
      h.textContent = (r0.tbl === 'messages' ? '💬 ' : r0.tbl === 'group_messages' ? '👥 ' : '# ') + r0.context_name; out.appendChild(h);
      list.forEach(r => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'srchhit';
        b.innerHTML = `<div class="small muted"><b>${esc(r.sender_name || 'Unknown')}</b> · ${esc(new Date(r.created_at).toLocaleString())}</div><div>${searchMark(r.snippet || r.body || '')}</div>`;
        b.onclick = () => {
          card.remove(); pendingJump = { table: r.tbl, id: r.id };
          go(r.tbl === 'messages' ? 'messages/dm/' + r.context_id : r.tbl === 'group_messages' ? 'messages/g/' + r.context_id : `messages/s/${r.server_id}/${r.context_id}`);
        };
        out.appendChild(b);
      });
    });
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
  inp.onkeydown = e => { if (e.key === 'Escape') card.remove(); };
  setTimeout(() => inp.focus());
}

const SV_CATEGORIES = [['gaming', 'Gaming'], ['minecraft', 'Minecraft'], ['tech', 'Tech'], ['art', 'Art'], ['music', 'Music'], ['education', 'Education'], ['community', 'Community'], ['other', 'Other']];
const catLabel = c => (SV_CATEGORIES.find(x => x[0] === c) || [0, c || ''])[1];
function mgDiscover() {
  $('mg').classList.add('mob-pane');
  $('mgPane').innerHTML = `<div class="head">🧭 Discover servers<span class="sp"></span><button class="btn sm mob-back" id="dcBack">← Back</button></div>
    <div style="padding:14px 18px;overflow-y:auto;flex:1"><div class="row"><input class="in" id="dcQ" maxlength="50" placeholder="Search public servers" style="flex:1;min-width:160px" autocomplete="off">
      <select class="in" id="dcCat" style="width:auto"><option value="">All categories</option>${SV_CATEGORIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div id="dcOut" class="dcgrid"></div><div class="row" id="dcPager" style="margin-top:12px;justify-content:center"></div>
      <p class="muted small">Only servers their owners chose to list, with at least 3 members. Joining is like using an invite code.</p></div>`;
  $('dcBack').onclick = () => { $('mg').classList.remove('mob-pane'); };
  let page = 0, seq = 0, timer = null;
  const load = async () => {
    const my = ++seq, out = $('dcOut'); out.innerHTML = '<div class="empty">Loading…</div>';
    const { data, error } = await sb.rpc('list_public_servers', { search: $('dcQ').value.trim(), cat: $('dcCat').value || null, page });
    if (my !== seq || !$('dcOut')) return;
    if (error) { out.innerHTML = `<div class="empty">${esc(error.message)}</div>`; $('dcPager').innerHTML = ''; return; }
    if (!data.length) { out.innerHTML = '<div class="empty">No public servers match.</div>'; $('dcPager').innerHTML = ''; return; }
    out.innerHTML = data.map(s => `<div class="card dccard"><div class="row" style="flex-wrap:nowrap"><span class="dcicon">${esc(s.icon || [...s.name][0].toUpperCase())}</span>
        <div style="min-width:0"><b>${esc(s.name)}</b><div class="small muted">${esc(catLabel(s.category))} · ${s.member_count} members</div></div></div>
        <p class="small" style="margin:8px 0">${esc(s.description || '')}</p>
        <button class="btn sm ${s.joined ? '' : 'primary'}" data-id="${esc(s.id)}" data-j="${s.joined ? 1 : 0}">${s.joined ? 'Open' : 'Join'}</button></div>`).join('');
    const total = Number(data[0].total) || data.length, pages = Math.max(1, Math.ceil(total / 20));
    $('dcPager').innerHTML = `<button class="btn sm" id="dcPrev"${page <= 0 ? ' disabled' : ''}>← Prev</button><span class="small muted">Page ${page + 1} of ${pages}</span><button class="btn sm" id="dcNext"${page + 1 >= pages ? ' disabled' : ''}>Next →</button>`;
    $('dcPrev').onclick = () => { page--; load(); }; $('dcNext').onclick = () => { page++; load(); };
    out.querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
      if (b.dataset.j === '1') { go('messages/s/' + b.dataset.id); return; }
      b.disabled = true;
      const { data: sid, error: e2 } = await sb.rpc('join_public_server', { sid: b.dataset.id });
      if (e2) { b.disabled = false; return fail(e2); }
      svCache = null; toast('Joined!'); go('messages/s/' + sid);
    });
  };
  $('dcQ').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; load(); }, 300); };
  $('dcCat').onchange = () => { page = 0; load(); };
  load(); setTimeout(() => $('dcQ') && $('dcQ').focus());
}

// Custom server emoji: public-read `server-emoji` bucket, paths are validated before they ever reach an <img src>.
const EMOJI_MAX_BYTES = 262144, EMOJI_MAX_COUNT = 50, EMOJI_TYPES = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
function emojiUrl(path) {
  return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/.test(path || '') ? `${SUPABASE_URL}/storage/v1/object/public/server-emoji/${path}` : null;
}
async function svLoadEmojis(sid) {
  const { data, error } = await sb.from('server_emojis').select('id,name,path').eq('server_id', sid).order('name');
  const list = error ? [] : data, map = new Map();
  list.forEach(e => { const u = emojiUrl(e.path); if (u) map.set(e.name, u); });
  return { list, map };
}
function mgSettings() {
  const { s, mine } = svCache;
  $('mg').classList.add('mob-pane');
  const owner = s.myRole === 'owner';
  $('mgPane').innerHTML = `<div class="head">⚙ ${esc(s.name)} settings<span class="sp"></span><button class="btn sm" id="stBack">Back to chat</button></div>
    <div style="padding:18px;overflow-y:auto;flex:1;max-width:640px">
      <h4 style="margin:0 0 8px">General</h4>
      <div class="row"><button class="btn sm" id="stRename">Rename</button><button class="btn sm" id="stIcon">Change icon</button>${owner ? '<button class="btn sm danger" id="stDelete">Delete server</button>' : ''}</div>
      <div id="svlBox"></div>
      <h4 style="margin:22px 0 4px">Custom emoji <span class="muted small" id="emCount"></span></h4>
      <p class="muted small" style="margin:0 0 8px">PNG, GIF or WebP, up to 256 KB. Members type <code>:name:</code> in this server's channels.</p>
      <div id="emList" class="emlist"><div class="empty">Loading…</div></div>
      <div class="row" style="margin-top:10px;align-items:flex-end"><div class="empreview" id="emPrev">?</div>
        <div style="flex:1;min-width:160px"><label class="lbl" style="margin-top:0">Name (a-z, 0-9, _)</label><input class="in" id="emName" maxlength="32" placeholder="pog" autocomplete="off"></div>
        <input type="file" id="emFile" accept="image/png,image/gif,image/webp" hidden><button class="btn" id="emPick">Choose image…</button><button class="btn primary" id="emUp" disabled>Upload</button></div>
      <div class="small muted" id="emNote" style="margin-top:4px"></div>
      <h4 style="margin:22px 0 4px">Public directory</h4>
      ${owner ? `<p class="muted small" style="margin:0 0 6px">List this server in Discover so anyone can find and join it. Needs at least 3 members, a description and a category.</p>
        <label class="item" style="cursor:pointer"><input type="checkbox" id="dirOn"${s.is_public ? ' checked' : ''}> List in directory</label>
        <label class="lbl">Description (up to 300 characters)</label><textarea class="in" id="dirDesc" rows="3" maxlength="300">${esc(s.description || '')}</textarea>
        <label class="lbl">Category</label><select class="in" id="dirCat"><option value="">Choose…</option>${SV_CATEGORIES.map(([v, l]) => `<option value="${v}"${s.category === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <div style="margin-top:12px"><button class="btn primary" id="dirSave">Save</button></div>`
      : `<p class="muted small">${s.is_public ? 'This server is listed in Discover.' : 'This server isn\'t listed.'} Only the owner can change that.</p>`}</div>`;
  $('stBack').onclick = () => route();
  svlMount($('svlBox'), { s, level: (svCache.spark || {}).level, members: svCache.members, nameOf: uid => dname(profiles.get(uid)), reload: async () => { await loadServerList(); mgSettingsReload(s.id); } });
  mgWebhooksMount(s, $('mgPane').lastElementChild);
  $('stRename').onclick = async () => { const n = prompt('New name', s.name); if (!n) return; const r = await sb.from('servers').update({ name: n.trim().slice(0, 40) }).eq('id', s.id); if (r.error) fail(r.error); else { svCache = null; route(); } };
  $('stIcon').onclick = async () => { const n = prompt('New icon (emoji or letters)', s.icon || ''); if (n === null) return; const r = await sb.from('servers').update({ icon: n.slice(0, 8) || null }).eq('id', s.id); if (r.error) fail(r.error); else { svCache = null; route(); } };
  if ($('stDelete')) $('stDelete').onclick = async () => {
    if (!confirm(`Delete ${s.name} for everyone? This can't be undone.`)) return;
    const r = await sb.from('servers').delete().eq('id', s.id); if (r.error) return fail(r.error); sb.functions.invoke('purge-server-media', { body: { server_id: s.id } }).catch(() => {}); svCache = null; go('messages');
  };
  // ---- emoji
  let file = null;
  const drawList = async () => {
    const { list, map } = await svLoadEmojis(s.id); svCache.emojis = list; svCache.emojiMap = map;
    if (!$('emList')) return;
    $('emCount').textContent = `${list.length} / ${EMOJI_MAX_COUNT}`;
    $('emList').innerHTML = list.length ? list.map(e => { const u = emojiUrl(e.path);
      return `<div class="emrow">${u ? `<img class="cemoji big" src="${esc(u)}" alt="">` : ''}<code>:${esc(e.name)}:</code><button class="btn sm danger" data-id="${esc(e.id)}" data-p="${esc(e.path)}">Delete</button></div>`; }).join('') : '<div class="empty">No custom emoji yet.</div>';
    $('emList').querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this emoji?')) return;
      const r = await sb.from('server_emojis').delete().eq('id', b.dataset.id); if (r.error) return fail(r.error);
      sb.storage.from('server-emoji').remove([b.dataset.p]).catch(() => {}); drawList();
    });
  };
  drawList();
  $('emPick').onclick = () => $('emFile').click();
  $('emFile').onchange = () => {
    const f = $('emFile').files[0]; $('emFile').value = ''; file = null; $('emUp').disabled = true; $('emNote').textContent = ''; $('emPrev').textContent = '?'; $('emPrev').style.backgroundImage = '';
    if (!f) return;
    if (!EMOJI_TYPES[f.type]) return toast('Emoji must be PNG, GIF or WebP.');
    if (f.size > EMOJI_MAX_BYTES) return toast(`That file is ${Math.ceil(f.size / 1024)} KB - emoji can be up to 256 KB.`);
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { $('emPrev').textContent = ''; $('emPrev').style.backgroundImage = `url(${url})`; $('emNote').textContent = im.naturalWidth === im.naturalHeight ? `${im.naturalWidth}x${im.naturalHeight}, ${Math.ceil(f.size / 1024)} KB` : `${im.naturalWidth}x${im.naturalHeight} is not square - it will look squashed next to text. Square images work best.`; };
    im.onerror = () => { toast('That image could not be read.'); URL.revokeObjectURL(url); };
    im.src = url; file = f;
    if (!$('emName').value) $('emName').value = f.name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    $('emUp').disabled = false;
  };
  $('emUp').onclick = async () => {
    const name = $('emName').value.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(name)) return toast('Emoji names are 2-32 letters, numbers or _.');
    if (!file) return;
    $('emUp').disabled = true;
    const path = `${s.id}/${name}-${crypto.randomUUID().slice(0, 8)}.${EMOJI_TYPES[file.type]}`;
    const up = await sb.storage.from('server-emoji').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });
    if (up.error) { $('emUp').disabled = false; return fail(up.error); }
    const ins = await sb.from('server_emojis').insert({ server_id: s.id, name, path, created_by: me.id });
    if (ins.error) { sb.storage.from('server-emoji').remove([path]).catch(() => {}); $('emUp').disabled = false; return fail(ins.error.code === '23505' ? new Error('There is already an emoji with that name.') : ins.error); }
    file = null; $('emName').value = ''; $('emNote').textContent = ''; $('emPrev').textContent = '?'; $('emPrev').style.backgroundImage = ''; toast(`:${name}: added`); drawList();
  };
  if ($('dirSave')) $('dirSave').onclick = async () => {
    const { error } = await sb.rpc('set_server_directory', { sid: s.id, listed: $('dirOn').checked, descr: $('dirDesc').value, cat: $('dirCat').value || null });
    if (error) return fail(error);
    toast($('dirOn').checked ? 'Server listed in Discover' : 'Saved'); svCache = null; await loadServerList(); mgSettingsReload(s.id);
  };
}
async function mgSettingsReload(sid) { await svLoadChannels(sid); mgRenderServerShell(sid); if (svCache.s) mgSettings(); }

// ---------------------------------------------------------------- reactions & forwarding helpers (shared)
const REACTABLE_TABLES = new Set(['messages', 'group_messages', 'channel_messages']);
const REACT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
// Small quick-pick popover for adding a reaction - deliberately separate from the composer's :shortcode: emoji
// picker (different job: pick ONE emoji to react with, not insert text) but reuses the same EMOJI table/markup.
function showReactPicker(e, onPick) {
  e.stopPropagation();
  document.querySelector('.react-picker')?.remove();
  const pk = document.createElement('div'); pk.className = 'picker react-picker';
  pk.innerHTML = REACT_QUICK.map(em => `<button type="button" data-e="${em}">${em}</button>`).join('')
    + `<button type="button" title="More…" id="reactMore">➕</button>`;
  document.body.appendChild(pk);
  const r = e.target.getBoundingClientRect();
  pk.style.position = 'fixed'; pk.style.width = 'auto'; pk.style.bottom = ''; pk.style.right = '';
  pk.style.left = Math.min(r.left, window.innerWidth - 260) + 'px'; pk.style.top = (r.bottom + 6) + 'px';
  pk.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'reactMore') { pk.innerHTML = Object.entries(EMOJI).map(([k, v]) => `<button type="button" data-e="${v}" title=":${k}:">${v}</button>`).join(''); return; }
    onPick(b.dataset.e); pk.remove();
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }));
}
// Forwarding targets: every DM (accepted friend), group chat and server channel the user is part of - reusing
// the same fetching this file already does for the Home list (loadFriends/acceptedFriends) and for servers.
async function getForwardTargets() {
  const targets = [];
  try { await loadFriends(); } catch (e) {}
  acceptedFriends().forEach(p => targets.push({ type: 'dm', id: p.id, label: `DM: ${dname(p)}` }));
  try {
    const { data } = await sb.from('group_members').select('group_id, group_chats(id,name)').eq('user_id', me.id);
    (data || []).forEach(x => { if (x.group_chats) targets.push({ type: 'group', id: x.group_chats.id, label: `👥 ${x.group_chats.name}` }); });
  } catch (e) {}
  try {
    const { data } = await sb.from('server_members').select('server_id, servers(id,name)').eq('user_id', me.id);
    for (const x of (data || [])) {
      if (!x.servers) continue;
      const { data: chans } = await sb.from('channels').select('id,name').eq('server_id', x.server_id).order('position');
      (chans || []).forEach(c => targets.push({ type: 'channel', id: c.id, label: `${x.servers.name} / #${c.name}` }));
    }
  } catch (e) {}
  return targets;
}
async function forwardMessage(target, m, senderProfile) {
  const fromName = m.sender ? dname(senderProfile) : 'AI', body = m.body || (m.attachments ? '📎 Attachment' : '');
  const extra = { forwarded_from_name: fromName, forwarded_from_body: body, ...(m.__tbl && m.id ? { forwarded_from_ref: m.__tbl + ':' + m.id } : {}) };
  const table = target.type === 'dm' ? 'messages' : target.type === 'group' ? 'group_messages' : 'channel_messages';
  const row = target.type === 'dm' ? { sender: me.id, recipient: target.id, body, ...extra }
    : target.type === 'group' ? { group_id: target.id, sender: me.id, body, ...extra }
    : { channel_id: target.id, sender: me.id, body, ...extra };
  const { error } = await sb.from(table).insert(row);
  if (error) fail(error); else toast(`Forwarded to ${target.label}`);
}
function showForwardPicker(e, m, senderProfile) {
  e.stopPropagation();
  document.querySelector('.fwd-picker')?.remove();
  const pk = document.createElement('div'); pk.className = 'picker fwd-picker';
  pk.style.position = 'fixed'; pk.style.width = '260px'; pk.style.maxHeight = '280px'; pk.style.bottom = ''; pk.style.right = '';
  pk.innerHTML = '<div class="empty" style="padding:10px">Loading…</div>';
  document.body.appendChild(pk);
  const r = e.target.getBoundingClientRect();
  pk.style.left = Math.min(r.left, window.innerWidth - 280) + 'px'; pk.style.top = (r.bottom + 6) + 'px';
  getForwardTargets().then(targets => {
    if (!pk.isConnected) return;
    pk.innerHTML = targets.length
      ? `<div class="small muted" style="padding:8px 10px 2px">Forward to…</div>` + targets.map((t, i) => `<button type="button" class="item" data-i="${i}" style="width:100%;text-align:left;font-size:14px">${esc(t.label)}</button>`).join('')
      : '<div class="empty" style="padding:10px">Nowhere to forward to yet.</div>';
    pk.onclick = ev => { const b = ev.target.closest('[data-i]'); if (!b) return; forwardMessage(targets[+b.dataset.i], m, senderProfile); pk.remove(); };
  }).catch(fail);
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }));
}

// ---------------------------------------------------------------- friends (used by DMs, groups, projects)
let friends = [];
async function loadFriends() {
  const { data, error } = await sb.from('friendships').select('requester,addressee,status');
  if (error) throw error;
  const rows = data.map(f => ({ ...f, other: f.requester === me.id ? f.addressee : f.requester, incoming: f.addressee === me.id }));
  await getProfiles(rows.map(r => r.other));
  friends = rows;
  return rows;
}
const acceptedFriends = () => friends.filter(f => f.status === 'accepted').map(f => profiles.get(f.other)).filter(Boolean);

// ---------------------------------------------------------------- router
const main = () => $('view');
const NEEDS_AUTH = new Set(['messages', 'servers', 'dms', 'groups', 'profile', 'settings', 'hosting', 'projects', 'admin']);
// 'localai' is deliberately NOT in this set - pairing with a PC needs no Auoris account at all (same as
// mobile.html today), so it must stay reachable straight from a fresh install, signed in or not.
function go(path) { history.pushState(null, '', '/' + path); route(); }
async function route() {
  pageSubs.forEach(f => { try { f(); } catch (e) {} }); pageSubs = [];
  const safeDec = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
  const [name = '', ...args] = location.pathname.replace(/^\/?/, '').split('/').map(safeDec);
  document.querySelectorAll('#topnav a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
  if (NEEDS_AUTH.has(name) && !me) return go('signin');
  legalFooter(); legalSiteCheck();
  const page = PAGES[name] || PAGES[''];
  window.scrollTo(0, 0);
  try { await page(...args); } catch (e) { main().innerHTML = `<div class="wrap page"><div class="card">Something went wrong: ${esc(e.message || e)}</div></div>`; }
  // Pages swap instantly (it's all static + client-side), which reads as jarring/broken with zero transition -
  // a quick fade makes the same speed feel intentional instead of like content just snapped into place.
  main().classList.remove('pagefade');
  void main().offsetWidth;  // restart the CSS animation
  main().classList.add('pagefade');
}
function renderHeader() {
  const links = me
    ? [['', 'Home'], ['messages', 'Messages'], ['projects', 'Projects'], ['hosting', 'Hosting'], ['localai', 'Local AI'], ['plus', 'Plus'], ...(myProfile && myProfile.is_admin ? [['admin', 'Admin']] : [])]
    : [['', 'Home'], ['localai', 'Local AI'], ['plus', 'Plus']];
  $('topnav').innerHTML = links.map(([r, t]) => `<a href="/${r}" data-r="${r}">${t}</a>`).join('');
  $('me').innerHTML = me && myProfile
    ? `<button id="meBtn">${plainAv(myProfile, 'sm')}<span class="name">${esc(dname(myProfile))}</span></button>
       <div id="meMenu" hidden><a href="/profile">Profile</a><a href="/settings">Settings</a><a href="/ai">AI Providers</a><a href="/plus">Auoris Plus</a><hr><a href="#" id="signOut">Sign out</a></div>`
    : `<a class="btn primary sm" href="/signin">Sign in</a>`;
  if ($('meBtn')) {
    $('meBtn').onclick = e => { e.stopPropagation(); $('meMenu').hidden = !$('meMenu').hidden; };
    $('signOut').onclick = e => { e.preventDefault(); sb.auth.signOut(); };
  }
}
// renderHeader() runs on every sign-in/out/profile-save - registered once here instead of inside it, or every
// call would stack another document-wide click listener that's never cleaned up.
document.addEventListener('click', () => { if ($('meMenu')) $('meMenu').hidden = true; });

// ---------------------------------------------------------------- pages
const PAGES = {};

// ---- home page decoration (all inline SVG / CSS / generated pixel art, no external images)
const DC_ICON = {
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pad: '<path d="M6 12h4M8 10v4"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.4 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.68-7.26A4 4 0 0 0 17.32 5z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
};
const dcIcon = (k, hue) => `<span class="dc-ic" style="--h:${hue}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DC_ICON[k]}</svg></span>`;
const dcFeat = (k, hue, t, d) => `<div class="card feat dc-feat" style="--hh:${hue}">${dcIcon(k, hue)}<h3>${t}</h3><p>${d}</p></div>`;
const MC_IMG = n => `<img src="/img/mc/${n}.png" alt="" loading="lazy">`;
const dcAppMock = () => `<div class="dc-win dc-hero-win" aria-hidden="true">
  <div class="dc-bar"><i></i><i></i><i></i><span>Auoris</span></div>
  <div class="dc-body">
    <div class="dc-rail"><b class="on"></b><b></b><b></b><b></b><b></b></div>
    <div class="dc-side"><div class="dc-sh">Chats</div><div class="dc-li on"><u></u><s>Project helper</s></div><div class="dc-li"><u></u><s>Weekly planning</s></div><div class="dc-li"><u></u><s>Daily summary</s></div><div class="dc-li"><u></u><s>Tax questions</s></div></div>
    <div class="dc-main">
      <div class="dc-msg me"><p>Find why the build fails and fix it.</p></div>
      <div class="dc-msg ai"><div class="dc-tool">⚙ read_file  build.ps1</div><div class="dc-tool">⚙ run_command  python -m pytest</div><p>Found it: a missing import on line 42. Fixed, and the tests pass now.</p></div>
      <div class="dc-msg me"><p>Nice. Commit it.</p></div>
      <div class="dc-input"><span>Message Auoris…</span><b>↑</b></div>
    </div></div></div>`;
const dcMsgMock = () => `<div class="dc-win dc-msg-win" aria-hidden="true"><div class="dc-body">
  <div class="dc-rail"><b class="on"></b><em style="--c:#8b5cf6">G</em><em style="--c:#34e6a8">M</em><em style="--c:#ff7a1f">R</em></div>
  <div class="dc-side"><div class="dc-sh">Direct messages</div><div class="dc-li on"><u style="--c:#5b9dff"></u><s>Alex</s></div><div class="dc-li"><u style="--c:#ff7a8a"></u><s>Weekend group</s></div><div class="dc-li"><u style="--c:#34e6a8"></u><s>Sam</s></div></div>
  <div class="dc-main">
    <div class="dc-chat"><u style="--c:#5b9dff"></u><div><b>Alex</b><p>want to hop on the server later?</p></div></div>
    <div class="dc-chat"><u style="--c:#34e6a8"></u><div><b>You</b><p>yep, 8pm. sending the pack 👇</p><div class="dc-file">📎 cool-pack.zip · 12 MB <i>scanned ✓</i></div></div></div>
    <div class="dc-chat"><u style="--c:#5b9dff"></u><div><b>Alex</b><p>🔥</p><div class="dc-react">🔥 2 &nbsp; 👍 1</div></div></div>
  </div></div></div>`;
const dcPhone = () => `<div class="dc-phone" aria-hidden="true"><div class="dc-notch"></div>
  <div class="dc-pchat"><div class="dc-pb them">Is the model on your PC done?</div><div class="dc-pb me">Yep, ask it anything</div><div class="dc-pb them">📱 on the couch, nice</div></div><div class="dc-pin">Message…</div></div>`;

PAGES[''] = async () => {
  main().innerHTML = `
  <section class="hero"><div class="stars"></div><div class="aur a1"></div><div class="aur a2"></div><div class="aur a3"></div>
    <div class="hero-in">
    <div class="logowrap"><span class="ring r1"></span><span class="ring r2"></span><img src="/logo.png" alt=""></div>
    <h1>Meet <span class="grad">Auoris</span></h1>
    <p>A desktop AI agent for local Ollama models or your own cloud keys, with servers, DMs, group chats, rich presence and a phone companion.</p>
    <div class="row"><a class="btn primary" href="#dl" id="dlTop">⬇ Download for Windows</a>${me ? '<a class="btn" href="/messages">Open Messages</a>' : '<a class="btn" href="/signup">Create an account</a>'}</div>
    ${dcAppMock()}</div></section>
  <section class="band"><div class="wrap"><h2>What's inside</h2><p class="lead">Your chats, files and models stay on your own PC.</p><div class="grid dc-grid3">
    ${dcFeat('cpu', 215, 'Local + cloud AI', 'Local Ollama models, or your own Anthropic / OpenAI-style keys.')}
    ${dcFeat('wrench', 160, 'Real tool access', 'Reads and edits files, runs commands and browses the web when you let it.')}
    ${dcFeat('chat', 265, "Servers, DMs & groups", 'Servers with channels, roles and banners, DMs and group chats, with :emoji:.')}
    ${dcFeat('pad', 25, 'Rich presence', 'See what friends are playing - and their Minecraft server or Roblox game - with a link to join.')}
    ${dcFeat('users', 190, 'AI projects', "Shared AI projects with friends, without ever exposing anyone's API key.")}
    ${dcFeat('spark', 320, 'Auoris Plus', 'Banners, profile effects, AI Providers, hosting and a gaming boost.')}</div></div></section>
  <section class="band alt"><div class="wrap dc-split"><div class="dc-txt"><span class="dc-kick">Messages</span><h2>Every chat in one place</h2>
    <p class="lead">Servers, DMs and group chats live side by side. Reply, react, pin, forward, edit and send files up to 50 MB - everything is scanned before it reaches anyone.</p>
    <ul class="dc-list"><li>Voice-style rail with all your servers</li><li>GIFs, reactions, replies and scheduled messages</li><li>Block, mute and privacy controls you actually own</li></ul></div>${dcMsgMock()}</div></section>
  <section class="band"><div class="wrap"><div class="dc-txt dc-center"><span class="dc-kick">Minecraft</span><h2>Make your Minecraft yours</h2>
    <p class="lead">Capes, hats, pets and tool skins, with a live preview of your real skin. Other Auoris players see them too, and your nametag gets the Auoris moon.</p></div>
    <div class="dc-mc">
      <div class="dc-tag"><img src="/img/mc/auoris-logo.png" alt="" class="px"><span>Steve</span></div>
      <div class="dc-row capes">${['auoris', 'aurora_wave', 'starlight', 'midnight', 'inferno', 'frostbite', 'royal', 'toxic'].map(n => MC_IMG('cape_' + n)).join('')}</div>
      <div class="dc-row pets">${['dog', 'cat', 'fox', 'parrot', 'dragon'].map(n => MC_IMG('pet_' + n)).join('')}</div>
      <div class="dc-row hats">${['wizard', 'crown', 'top_hat', 'viking', 'party', 'cat_ears'].map(n => MC_IMG('hat_' + n)).join('')}</div>
      <div class="dc-row tools">${['frostbite', 'molten', 'void', 'aurora', 'golden', 'emerald'].map(n => MC_IMG('tool_' + n)).join('')}</div>
    </div><p class="muted small" style="text-align:center;margin-top:18px">Works with the Auoris mod on Minecraft 1.8.9 (Forge). Auoris installs it for you.</p></div></section>
  <section class="band alt" id="mobile"><div class="wrap dc-split rev">${dcPhone()}<div class="dc-txt"><span class="dc-kick">On your phone</span><h2>Auoris on your phone</h2><p class="lead" style="text-align:left">No App Store needed. Install this site as an app - Servers, DMs, group chats, AI projects, Hosting and Plus all work from anywhere, cellular data included.</p><ol class="steps" style="margin:0">
    <li>Tap Share (iPhone) or the browser menu (Android) → <b>Add to Home Screen</b> / <b>Install app</b>. It now opens full-screen, like an installed app.</li>
    <li>Sign in once - friends, servers and DMs sync the same as the desktop app and website.</li>
    <li>Want to chat with your PC's own local AI model too? Open <a href="/localai">Local AI</a> and pair with your PC - that one feature needs to be on the same Wi-Fi, since the model runs on your PC.</li></ol></div></div></section>
  <section class="band dc-dl" id="dl"><div class="wrap" style="text-align:center"><h2>Download</h2><p class="lead">Windows 10/11. The installer sets up Ollama for you.</p>
    <a class="btn primary" id="dlBtn" href="https://github.com/9cWork/auoris/releases/latest">⬇ Download Auoris-Setup.exe</a><p class="muted small" id="dlVer">Checking latest version…</p></div></section>`;
  $('dlTop').onclick = e => { e.preventDefault(); $('dl').scrollIntoView(); };
  fetch('https://api.github.com/repos/9cWork/auoris/releases/latest').then(r => r.json()).then(d => {
    const a = (d.assets || []).find(x => x.name.toLowerCase() === 'auoris-setup.exe');
    if (a) { $('dlBtn').href = a.browser_download_url; $('dlVer').textContent = `${d.tag_name} · ${(a.size / 1048576).toFixed(1)} MB`; }
    else $('dlVer').textContent = d.tag_name || '';
  }).catch(() => { $('dlVer').textContent = 'See all releases on GitHub.'; });
};

// ---- sign in / sign up
const AUTH = { mode: 'login', email: '', pendingPass: null, resume: null, notice: null, bounced: false, social: false };
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
  declineLabel: 'Sign out',
  load: async () => {
    const meta = await (await fetch('/legal/legal.json', { cache: 'no-cache' })).json();
    meta.docs = await Promise.all(meta.docs.map(async d => ({ id: d.id, title: d.title, text: await (await fetch('/legal/' + encodeURIComponent(d.file), { cache: 'no-cache' })).text() })));
    return meta;
  },
  decline: async () => { await sb.auth.signOut(); me = myProfile = null; legalGateOpen = false; const g = document.getElementById('legalGate'); if (g) g.remove(); renderHeader(); go(''); },
  accept: async v => { const { error } = await sb.rpc('accept_legal', { v, src: 'web' }); if (error) throw error; myProfile.legal_version = v; },
};
async function legalSiteCheck() {   // signed-in visitors who haven't accepted the current version
  if (!me || !myProfile) return;
  let L = null; try { L = await legalGet(); } catch (e) { LEGAL.data = null; }
  if (!L || !L.version) { if (!legalSiteCheck.t) legalSiteCheck.t = setTimeout(() => { legalSiteCheck.t = 0; legalSiteCheck(); }, 4000); return; }   // couldn't load the documents: try again shortly
  if (myProfile.legal_version !== L.version) legalGate(L, !!myProfile.legal_version);
}
async function legalPage(id) {
  legalStyle();
  main().innerHTML = '<div class="wrap page" style="max-width:780px"><div class="card">Loading…</div></div>';
  const L = await legalGet(), d = L.docs.find(x => x.id === id) || L.docs[0];
  main().innerHTML = `<div class="wrap page" style="max-width:780px"><div class="card"><h1 style="margin-top:0">${esc(d.title)}</h1><p class="muted small">Version ${esc(L.version)}</p>
    <div class="legaldocs">${L.docs.map(x => `<a href="/${esc(x.id)}"><button class="${x.id === d.id ? 'on' : ''}" type="button">${esc(x.title)}</button></a>`).join('')}</div>
    <div class="lbody" style="font-size:14.5px;line-height:1.65">${legalMd(d.text, L)}${L.changes && L.changes.length ? `<h3>Recent changes</h3><ul>${L.changes.slice(0, 5).map(c => `<li><b>${esc(c.version)}</b> - ${esc(c.summary)}</li>`).join('')}</ul>` : ''}</div></div></div>`;
}
function legalFooter() {
  legalStyle();
  if (document.getElementById('siteFoot')) return;
  const f = document.createElement('footer'); f.id = 'siteFoot'; f.style.cssText = 'text-align:center;padding:22px 16px 28px;font-size:12.5px;color:var(--dim)';
  f.innerHTML = ['terms|Terms', 'privacy|Privacy', 'acceptable-use|Acceptable use', 'subscription-terms|Subscriptions', 'copyright|Copyright'].map(x => { const [i, t] = x.split('|'); return `<a href="/${i}" style="color:inherit;margin:0 8px">${t}</a>`; }).join('') + '<div style="margin-top:6px">© Auoris</div>';
  const m = document.getElementById('view'); if (m && m.parentNode) m.parentNode.insertBefore(f, m.nextSibling); else document.body.appendChild(f);
}
['terms', 'privacy', 'acceptable-use', 'subscription-terms', 'copyright'].forEach(id => { PAGES[id] = () => legalPage(id); });

PAGES.invite = async code => {
  main().innerHTML = '<div class="wrap page" style="max-width:420px"><div class="card" id="invBox">Loading invite…</div></div>';
  const pv = /^[A-Za-z0-9]{4,16}$/.test(code || '') ? await invPreview(code) : null;
  const box = $('invBox'); if (!box) return;
  if (!pv) { box.innerHTML = '<h3 style="margin-top:0">Invite not found</h3><p class="muted">This invite link is invalid or has been reset.</p><a class="btn" href="/">Home</a>'; return; }
  box.style.padding = '0'; box.style.overflow = 'hidden';
  box.innerHTML = `<div style="height:120px;${svlBannerCss(pv)}"></div><div style="padding:18px"><div class="row" style="align-items:center;gap:12px"><span style="width:52px;height:52px;border-radius:14px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700">${esc(pv.icon || (pv.name || '?')[0].toUpperCase())}</span>
    <div><h3 style="margin:0">${esc(pv.name)}</h3><div class="muted small">${Number(pv.member_count) || 0} member${Number(pv.member_count) === 1 ? '' : 's'}</div></div></div>
    ${pv.description ? `<p class="muted" style="margin:12px 0 0">${esc(pv.description)}</p>` : ''}
    <div style="margin-top:16px"><button class="btn primary" id="invJoin">${me ? 'Join server' : 'Sign in to join'}</button></div></div>`;
  $('invJoin').onclick = async () => {
    if (!me) { try { sessionStorage.setItem('auoris_after_signin', '/invite/' + code); } catch (e) {} return go('signin'); }
    $('invJoin').disabled = true;
    const { data, error } = await sb.rpc('join_server', { code });
    if (error) { $('invJoin').disabled = false; return fail(error); }
    svCache = null; go('messages/s/' + data);
  };
};
function afterAuthDest() {   // where to go once signed in: a pending invite link, else Messages
  let back = null; try { back = sessionStorage.getItem('auoris_after_signin'); sessionStorage.removeItem('auoris_after_signin'); } catch (e) {}
  return back && /^\/invite\/[A-Za-z0-9]{4,16}$/.test(back) ? back.slice(1) : 'messages';
}
PAGES.signin = async () => { if (me) return go(afterAuthDest()); authPage(AUTH.resume || 'login'); AUTH.resume = null; };
PAGES.signup = async () => { if (me) return go('messages'); authPage('signup'); };
function authPage(mode) {
  main().innerHTML = `<div class="authwrap"><div class="card authcard"><img src="/logo.png" alt="" style="width:56px;border-radius:14px">
    <h2 id="authTitle"></h2><p class="sub" id="authSub"></p><div id="authOauth"></div><form id="authForm" autocomplete="on" novalidate></form><div id="authErr"></div><div id="authLinks"></div><div class="legalnote">By continuing you agree to our <a href="/terms">Terms</a>, <a href="/privacy">Privacy Policy</a> and <a href="/acceptable-use">Acceptable Use Policy</a>.</div></div></div>`;
  authShow(mode);
  // A message to show: a suspended account that was bounced here, or the provider's reason when social sign-in failed
  // (Supabase redirects back with #error_description=... or ?error_description=...).
  const eh = new URLSearchParams((location.hash || '').replace(/^#/, '') + '&' + (location.search || '').replace(/^\?/, ''));
  const msg = AUTH.notice || eh.get('error_description');
  AUTH.notice = null;
  if (msg) authErr(String(msg).slice(0, 200));
}
const OAUTH_PROVIDERS = [['google', 'Google', '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'], ['azure', 'Microsoft', '<svg viewBox="0 0 23 23" width="18" height="18"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>'], ['github', 'GitHub', '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>']];
// Which providers are switched on in Supabase (public endpoint) - buttons only show for those.
let oauthEnabled = null;
async function oauthLoad() {
  if (oauthEnabled) return oauthEnabled;
  try {
    const r = await fetch({ url: SUPABASE_URL, key: SUPABASE_KEY }.url + '/auth/v1/settings', { headers: { apikey: { url: SUPABASE_URL, key: SUPABASE_KEY }.key } });
    const j = await r.json();
    oauthEnabled = r.ok && j.external ? j.external : { __all: true };
  } catch (e) { oauthEnabled = { __all: true }; }  // can't tell which are on: show them all, a disabled one just says so when clicked
  return oauthEnabled;
}
async function oauthRender(mode) {
  const box = $('authOauth'); if (!box) return;
  if (mode !== 'login' && mode !== 'signup') { box.innerHTML = ''; return; }
  const on = await oauthLoad();
  if (AUTH.mode !== mode) return;
  const list = OAUTH_PROVIDERS.filter(p => on.__all || on[p[0]]);
  box.innerHTML = list.length ? '<div class="oauthrow">' + list.map(p => `<button type="button" class="oauthbtn" data-p="${p[0]}">${p[2]}<span>${p[1]}</span></button>`).join('') + '</div><div class="oauthor"><span>or</span></div>' : '';
  box.querySelectorAll('.oauthbtn').forEach(b => b.onclick = () => oauthStart(b.dataset.p));
}
async function oauthStart(provider) {
  authErr('');
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + '/signin', scopes: provider === 'azure' ? 'email' : undefined } });
  if (error) authErr(error.message);
}
function authShow(mode, sub) {
  AUTH.mode = mode;
  const T = {
    login: ['Welcome back', 'Sign in to Auoris'], signup: ['Create your account', 'You\'ll pick a username after verifying your email'],
    username: ['Pick a username', 'This is how friends find you. It can\'t be changed later.'], verify: ['Check your email', `We sent a code to ${AUTH.email}`],
    forgot: ['Reset your password', 'We\'ll email you a code'], reset: ['Choose a new password', `Enter the code sent to ${AUTH.email}`],
    mfa: ['Two-factor code', 'Enter the code from your authenticator app'],
  }[mode];
  $('authTitle').textContent = T[0]; $('authSub').textContent = sub || T[1];
  const inp = (id, label, type, extra) => `<label class="lbl" for="${id}">${label}</label><input class="in" id="${id}" name="${id}" type="${type}" ${extra}>`;
  const code = '<input class="in code" id="aCode" name="aCode" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="00000000" required>';
  const email = inp('aEmail', 'Email', 'email', 'autocomplete="email" required');
  $('authForm').innerHTML = {
    login: email + inp('aPass', 'Password', 'password', 'autocomplete="current-password" required') + '<button class="btn primary">Sign in</button>',
    signup: email + inp('aPass', 'Password', 'password', 'autocomplete="new-password" required minlength="8"') + inp('aDob', 'Date of birth (to check you are 13 or older - not stored)', 'date', 'required') + '<button class="btn primary">Create account</button>',
    username: inp('aUser', 'Username', 'text', 'autocomplete="username" required maxlength="20" pattern="[A-Za-z0-9_]{3,20}" title="3-20 letters, numbers or _"') + (AUTH.social ? inp('aDob', 'Date of birth (to check you are 13 or older - not stored)', 'date', 'required') : '') + '<button class="btn primary">Continue</button>',
    verify: code + '<button class="btn primary">Verify</button>', forgot: email + '<button class="btn primary">Send code</button>',
    reset: code + inp('aPass', 'New password', 'password', 'autocomplete="new-password" required minlength="8"') + '<button class="btn primary">Save password</button>',
    mfa: code + '<button class="btn primary">Verify</button>',
  }[mode];
  $('authLinks').innerHTML = {
    login: '<a href="/signup">Create an account</a><a data-m="forgot">Forgot password?</a>', signup: '<a href="/signin">I already have an account</a>',
    username: '<a data-m="signout">Use a different account</a>', verify: '<a data-m="resend">Resend code</a><a data-m="login">Back to sign in</a>',
    forgot: '<a data-m="login">Back to sign in</a>', reset: '<a data-m="login">Back to sign in</a>', mfa: '<a data-m="signout">Use a different account</a>',
  }[mode];
  $('authLinks').querySelectorAll('a[data-m]').forEach(a => a.onclick = async () => {
    const m = a.dataset.m;
    if (m === 'signout') { try { sessionStorage.removeItem('auoris_after_signin'); } catch (e) {} await sb.auth.signOut(); return authShow('login'); }
    if (m === 'resend') { const { error } = await sb.auth.resend({ type: 'signup', email: AUTH.email }); return authErr(error ? error.message : 'Sent a new code.', !error); }
    authShow(m);
  });
  if (AUTH.email && $('aEmail')) $('aEmail').value = AUTH.email;
  authErr('');
  oauthRender(mode);
  $('authForm').onsubmit = authSubmit;
  setTimeout(() => $('authForm').querySelector('input')?.focus());
}
function authErr(msg, ok) { $('authErr').textContent = msg; $('authErr').className = ok ? 'ok' : ''; }
function authValidate(m, v) {
  if ($('aEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('aEmail'))) return 'Enter a valid email address.';
  if ($('aDob') && (m === 'signup' || m === 'username')) { const e = authAgeOk($('aDob').value); if (e) return e; }
  if ($('aPass') && (m === 'signup' || m === 'reset') && $('aPass').value.length < 8) return 'Your password needs to be at least 8 characters.';
  if ($('aUser') && !/^[A-Za-z0-9_]{3,20}$/.test(v('aUser'))) return 'Usernames are 3-20 letters, numbers or _.';
  if ($('aCode') && !/^[0-9]{6,8}$/.test(v('aCode'))) return 'Enter the code we emailed you.';
  return null;
}
function authAgeOk(dobStr) {   // sign-up age check: 13+. The date is only used here and is never stored or sent.
  const d = new Date(dobStr); if (!dobStr || isNaN(d)) return 'Enter your date of birth.';
  const now = new Date(); let age = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (age < 0 || age > 120) return 'Enter a valid date of birth.';
  return age < 13 ? 'You must be at least 13 years old to use Auoris.' : null;
}
async function authSubmit(e) {
  e.preventDefault();
  const btn = $('authForm').querySelector('button'), v = id => ($(id)?.value || '').trim(), m = AUTH.mode;
  const problem = authValidate(m, v);
  if (problem) return authErr(problem);
  btn.disabled = true; authErr('');
  try {
    if ($('aEmail')) AUTH.email = v('aEmail');
    if (m === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email: AUTH.email, password: $('aPass').value });
      if (error && /confirm/i.test(error.message)) { await sb.auth.resend({ type: 'signup', email: AUTH.email }); return authShow('verify'); }
      if (error) throw error;
      await afterSignIn(true);
    } else if (m === 'signup') {
      if (/^[^@]*\+/.test(AUTH.email)) throw new Error('Email addresses with a + (like name+tag@mail.com) cannot be used. Please use your main address.');
      const { data, error } = await sb.auth.signUp({ email: AUTH.email, password: $('aPass').value });
      if (error) throw error;
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('An account with this email already exists. Sign in instead.');
      if (data.session) await afterSignIn(true); else authShow('verify');
    } else if (m === 'username') {
      const { error } = await sb.rpc('claim_username', { name: v('aUser') });
      // "you already have a username" means the profile row already exists (from an earlier attempt that
      // actually succeeded, or a transient re-check) - that's not a real error, just log them in.
      if (error && !/already have a username/i.test(error.message)) throw error;
      await afterSignIn(true);
    } else if (m === 'verify') {
      const { error } = await sb.auth.verifyOtp({ email: AUTH.email, token: v('aCode'), type: 'email' });
      if (error) throw error;
      await afterSignIn(true);
    } else if (m === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(AUTH.email);
      if (error) throw error;
      authShow('reset');
    } else if (m === 'reset') {
      const { error } = await sb.auth.verifyOtp({ email: AUTH.email, token: v('aCode'), type: 'recovery' });
      if (error) throw error;
      AUTH.pendingPass = $('aPass').value;
      await afterSignIn(true);
    } else if (m === 'mfa') {
      const { data } = await sb.auth.mfa.listFactors();
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.totp[0].id, code: v('aCode') });
      if (error) throw error;
      await afterSignIn(true);
    }
  } catch (err) {
    const msg = err.message || String(err);
    authErr(/fetch|network/i.test(msg) ? 'Can\'t reach the Auoris servers right now.' : msg);
  } finally { btn.disabled = false; }
}
async function afterSignIn(fromForm, quiet) {   // quiet: on a public page, remember the step the sign-in page needs but don't navigate there
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { if (!fromForm) { AUTH.resume = 'mfa'; if (quiet) return; AUTH.bounced = true; return go('signin'); } return authShow('mfa'); }
  if (AUTH.pendingPass) { const { error } = await sb.auth.updateUser({ password: AUTH.pendingPass }); AUTH.pendingPass = null; if (error) throw error; }
  const { data: { user }, error } = await sb.auth.getUser();
  if (error) throw error;
  const { data: prof, error: profErr } = await sb.from('profiles').select(PCOLS + ',banned,legal_version').eq('id', user.id).maybeSingle();
  if (profErr) throw profErr;  // a lookup failure isn't "no profile yet" - don't send an existing user to claim_username
  if (!prof) { AUTH.social = !!(user.app_metadata && user.app_metadata.provider && user.app_metadata.provider !== 'email'); if (!fromForm) { AUTH.resume = 'username'; if (quiet) return; AUTH.bounced = true; return go('signin'); } return authShow('username'); }
  if (prof.banned) {
    await sb.auth.signOut();
    if (!fromForm) { AUTH.notice = 'This account has been suspended.'; AUTH.resume = 'login'; AUTH.bounced = true; return go('signin'); }   // the sign-in page isn't on screen yet
    return authShow('login', 'This account has been suspended.');
  }
  me = user; myProfile = prof; profiles.set(prof.id, prof);
  await loadBlocks();
  renderHeader();
  if (fromForm) go(afterAuthDest());
}

// ---- Messages: Discord-style rail (Home -> merged DMs+groups, then one icon per server) -> list -> pane.
// One route family replaces the old separate /servers, /dms, /groups pages:
//   /messages            merged DM+group list, no conversation open
//   /messages/dm/<uid>   a DM open (list still shows the merged DM+group list)
//   /messages/g/<gid>    a group chat open (same list)
//   /messages/s/<sid>    a server's channel list, no channel open
//   /messages/s/<sid>/<cid>  a specific channel open
const rankRole = r => ({ owner: 3, admin: 2, moderator: 1, member: 0 })[r] ?? -1;
// serverList is just the rail's server icons (id/name/icon/myRole) - cheap, reloaded whenever Messages opens so
// the rail is right even when we're looking at Home (DMs/groups), not a particular server.
let serverList = [];
async function loadServerList() {
  const { data: mem, error } = await sb.from('server_members').select('server_id, role, servers(id,name,icon,invite_code,owner_id,is_public,description,category,banner_path)').eq('user_id', me.id);
  if (error) throw error;
  serverList = mem.filter(m => m.servers).map(m => ({ ...m.servers, myRole: m.role }));
}
// svCache holds the channels/members for whichever server is currently open, so switching channels within the
// same server (the common case) doesn't re-query all of that again - only a server switch, or an edit that
// changes it (new channel, rename, kick, role change), refetches. Set svCache = null to force a refetch.
// ================================================================ server look: banner, custom roles (name + colour + icon), invite embeds
// Shared verbatim by the desktop app and auoris.org. Roles are labels only - what a member may do is still the built-in rank.
function svlBase() { try { return attCfg.url; } catch (e) {} try { return SUPABASE_URL; } catch (e) {} return ''; }
function svlNote(m) { try { if (window.pywebview) toast('Servers', m); else toast(m); } catch (e) {} }
function svlUrl(path) { return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/.test(path || '') ? `${svlBase()}/storage/v1/object/public/server-media/${path}` : null; }
function svlRoleIcon(r, px) {
  px = px || 14; const u = svlUrl(r.icon_path), c = /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#99aab5';
  if (u) return `<img src="${esc(u)}" alt="" title="${esc(r.name)}" style="width:${px}px;height:${px}px;border-radius:3px;object-fit:cover;vertical-align:-2px;margin-left:4px">`;
  if (r.icon) return `<span title="${esc(r.name)}" style="font-size:${px}px;line-height:1;margin-left:4px">${esc(r.icon)}</span>`;
  return `<i title="${esc(r.name)}" style="display:inline-block;width:${Math.round(px * .6)}px;height:${Math.round(px * .6)}px;border-radius:50%;background:${c};margin-left:5px"></i>`;
}
function svlMemberRoles(uid) { const m = svCache && svCache.cm; return (m && m.get(uid)) || []; }
function svlNameColor(uid) { const r = svlMemberRoles(uid)[0]; return r && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : ''; }
function svlBadges(uid) { return svlMemberRoles(uid).slice(0, 4).map(r => svlRoleIcon(r, 14)).join(''); }
function svlBannerCss(s) { const u = s && svlUrl(s.banner_path); return u ? `background:#1d2331 url(${esc(u)}) center/cover` : 'background:linear-gradient(135deg,#2b4680,#1d2331)'; }
// Sparks: a Plus member can give up to 2; 2 Sparks = Level 1 (banner + image role icons)
async function svlSparkLoad(sid) { try { const r = await sb.rpc('server_spark_info', { sid }); return r.data || { count: 0, level: 0, mine: false, used: 0, slots: 2, plus: false }; } catch (e) { return { count: 0, level: 0, mine: false, used: 0, slots: 2, plus: false }; } }
function svlSparkHtml(sp, btnId) {
  const slots = Number(sp.slots) || 2, used = Number(sp.used) || 0, count = Number(sp.count) || 0, left = Math.max(0, slots - used);
  return `<div style="margin-top:8px">✦ <b>${count}</b> Spark${count === 1 ? '' : 's'} · Level ${Number(sp.level) || 0}<br><button type="button" class="btn sm" id="${btnId}" style="margin-top:6px" title="Auoris Plus members can give up to 2 Sparks. 2 Sparks unlock a server banner and image role icons.">${sp.mine ? 'Take back my Spark' : (sp.plus ? 'Give a Spark' : 'Give a Spark (Plus)')}</button> <span class="muted small">${sp.plus || sp.mine ? `${left} of ${slots} left` : 'Sparks come with Auoris Plus'}</span></div>`;
}
async function svlSparkClick(sid, sp, after) {
  if (!sp.mine && !sp.plus) return svlNote('Sparks come with Auoris Plus.');
  const r = await sb.rpc(sp.mine ? 'take_spark' : 'give_spark', { sid });
  if (r.error) return svlNote(r.error.message);
  svlNote(sp.mine ? 'Spark taken back' : 'Thanks for the Spark!'); after();
}
async function svlLoad(sid) {   // custom roles + who wears them; empty when the feature isn't set up on the server yet
  const out = { cr: [], cm: new Map() };
  try {
    const [a, b] = await Promise.all([sb.from('server_roles').select('*').eq('server_id', sid).order('position').order('created_at'),
      sb.from('server_member_roles').select('user_id,role_id').eq('server_id', sid)]);
    out.cr = a.data || [];
    const byId = new Map(out.cr.map(r => [r.id, r]));
    (b.data || []).forEach(x => { const r = byId.get(x.role_id); if (!r) return; if (!out.cm.has(x.user_id)) out.cm.set(x.user_id, []); out.cm.get(x.user_id).push(r); });
    out.cm.forEach(l => l.sort((p, q) => p.position - q.position));
  } catch (e) {}
  return out;
}
const svlExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
async function svlUpload(sid, kind, file) {
  if (!svlExt[file.type]) throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  if (file.size > (kind === 'banner' ? 3145728 : 262144)) throw new Error(kind === 'banner' ? 'Banners can be up to 3 MB.' : 'Role icons can be up to 256 KB.');
  const path = `${sid}/${kind}-${Math.random().toString(36).slice(2, 10)}.${svlExt[file.type]}`;
  const { error } = await sb.storage.from('server-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}
const svlDrop = path => { if (path) sb.storage.from('server-media').remove([path]).catch(() => {}); };
// The settings section. ctx: { s, members: [{user_id, role}], nameOf(uid), reload() }
function svlMount(box, ctx) {
  const s = ctx.s, sid = s.id, st = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit';
  const roles = (svCache && svCache.cr) || [];
  box.innerHTML = `<h4 style="margin:22px 0 4px">Banner</h4>
    <p class="muted small" style="margin:0 0 8px">Shown at the top of the channel list and on invite cards. A wide image works best, up to 3 MB.${(ctx.level || 0) < 1 ? ' <b>Needs 2 Sparks (Level 1).</b> Members with Auoris Plus can give Sparks from the channel list.' : ''}</p>
    <div id="svlBan" style="height:90px;border-radius:12px;${svlBannerCss(s)}"></div>
    <div class="row" style="margin-top:8px"><input type="file" id="svlBanFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button class="btn sm" id="svlBanPick"${(ctx.level || 0) < 1 ? ' disabled' : ''}>Upload banner…</button>${s.banner_path ? '<button class="btn sm danger" id="svlBanRm">Remove</button>' : ''}</div>
    <h4 style="margin:22px 0 4px">Roles <span class="muted small">${roles.length} / 20</span></h4>
    <p class="muted small" style="margin:0 0 8px">Name, colour and an icon (an emoji or a small image). Members wear them in the member list. Roles are labels - they don't change what anyone can do.</p>
    <div id="svlRoles"></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="svlAddRole"${roles.length >= 20 ? ' disabled' : ''}>＋ New role</button></div>`;
  box.querySelector('#svlBanPick').onclick = () => box.querySelector('#svlBanFile').click();
  box.querySelector('#svlBanFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const p = await svlUpload(sid, 'banner', f); const old = s.banner_path;
      const r = await sb.from('servers').update({ banner_path: p }).eq('id', sid); if (r.error) { svlDrop(p); throw r.error; }
      svlDrop(old); s.banner_path = p; svlNote('Banner updated'); ctx.reload(); } catch (err) { svlNote(err.message || String(err)); }
  };
  if (box.querySelector('#svlBanRm')) box.querySelector('#svlBanRm').onclick = async () => {
    const old = s.banner_path; const r = await sb.from('servers').update({ banner_path: null }).eq('id', sid);
    if (r.error) return svlNote(r.error.message); svlDrop(old); s.banner_path = null; ctx.reload();
  };
  const list = box.querySelector('#svlRoles');
  list.innerHTML = roles.length ? '' : '<div class="muted small">No roles yet.</div>';
  roles.forEach(r => {
    const row = document.createElement('div'); row.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:6px 0';
    row.innerHTML = `<div class="row" style="align-items:center;gap:8px;flex-wrap:wrap"><span class="rprev">${svlRoleIcon(r, 20)}</span>
      <input class="rname" maxlength="24" value="${esc(r.name)}" style="${st};flex:1;min-width:110px;width:auto"><input class="rcol" type="color" value="${esc(r.color)}" style="width:38px;height:30px;padding:0;border:0;background:none">
      <input class="remo" maxlength="4" placeholder="emoji" value="${esc(r.icon || '')}" title="Emoji icon" style="${st};width:64px;text-align:center">
      <input type="file" class="rfile" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button class="btn sm rpick" title="Use a small image as the icon (needs Spark Level 1)"${(ctx.level || 0) < 1 ? ' disabled' : ''}>Image</button>
      <button class="btn sm rsave primary">Save</button><button class="btn sm rwho">Members</button><button class="btn sm danger rdel">Delete</button></div><div class="rmem" hidden style="margin-top:8px;max-height:180px;overflow-y:auto"></div>`;
    list.appendChild(row);
    row.querySelector('.rpick').onclick = () => row.querySelector('.rfile').click();
    row.querySelector('.rfile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const p = await svlUpload(sid, 'role', f); const old = r.icon_path;
        const x = await sb.from('server_roles').update({ icon_path: p, icon: null }).eq('id', r.id); if (x.error) { svlDrop(p); throw x.error; }
        svlDrop(old); ctx.reload(); } catch (err) { svlNote(err.message || String(err)); }
    };
    row.querySelector('.rsave').onclick = async () => {
      const name = row.querySelector('.rname').value.trim(); if (!name) return svlNote('A role needs a name.');
      const icon = row.querySelector('.remo').value.trim() || null, upd = { name, color: row.querySelector('.rcol').value, icon };
      if (icon) upd.icon_path = null;
      const x = await sb.from('server_roles').update(upd).eq('id', r.id);
      if (x.error) return svlNote(x.error.code === '23505' ? 'There is already a role with that name.' : x.error.message);
      if (icon) svlDrop(r.icon_path); svlNote('Saved'); ctx.reload();
    };
    row.querySelector('.rdel').onclick = async () => {
      if (!window.confirm('Delete the role "' + r.name + '"?')) return;
      const x = await sb.from('server_roles').delete().eq('id', r.id); if (x.error) return svlNote(x.error.message); svlDrop(r.icon_path); ctx.reload();
    };
    row.querySelector('.rwho').onclick = () => {
      const m = row.querySelector('.rmem'); m.hidden = !m.hidden; if (m.hidden) return;
      m.innerHTML = ctx.members.map(x => { const has = svlMemberRoles(x.user_id).some(q => q.id === r.id);
        return `<label style="display:flex;gap:8px;align-items:center;padding:3px 0;cursor:pointer"><input type="checkbox" data-u="${esc(x.user_id)}" ${has ? 'checked' : ''}> <span>${esc(ctx.nameOf(x.user_id))}</span></label>`; }).join('');
      m.querySelectorAll('input').forEach(cb => cb.onchange = async () => {
        const q = cb.checked ? await sb.from('server_member_roles').insert({ server_id: sid, user_id: cb.dataset.u, role_id: r.id })
          : await sb.from('server_member_roles').delete().eq('role_id', r.id).eq('user_id', cb.dataset.u);
        if (q.error) { cb.checked = !cb.checked; return svlNote(q.error.message); }
        const fresh = await svlLoad(sid); svCache.cr = fresh.cr; svCache.cm = fresh.cm; if (ctx.refreshMembers) ctx.refreshMembers();
      });
    };
  });
  box.querySelector('#svlAddRole').onclick = async () => {
    const name = (window.prompt('Role name') || '').trim().slice(0, 24); if (!name) return;
    const x = await sb.from('server_roles').insert({ server_id: sid, name, color: '#5b9dff', position: roles.length });
    if (x.error) return svlNote(x.error.code === '23505' ? 'There is already a role with that name.' : x.error.message); ctx.reload();
  };
}
// Invite links pasted into a chat turn into a join card: https://auoris.org/invite/<code>
const INV_RE = /https?:\/\/(?:www\.)?auoris\.org\/invite\/([A-Za-z0-9]{4,16})/g, invCache = new Map();
function invPreview(code) {
  if (typeof sb === 'undefined' || !sb) return Promise.resolve(null);
  if (!invCache.has(code)) invCache.set(code, sb.rpc('invite_preview', { code }).then(r => { const v = (r.data && r.data[0]) || null; if (!v) invCache.delete(code); return v; }, () => { invCache.delete(code); return null; }));
  return invCache.get(code);
}
async function invCard(code) {
  const pv = await invPreview(code); if (!pv) return null;
  const card = document.createElement('div');
  card.style.cssText = 'max-width:340px;margin:6px 0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--panel)';
  const mine = (typeof serverList !== 'undefined' && serverList.some(x => x.id === pv.id)) || (typeof svCache !== 'undefined' && svCache && svCache.servers && svCache.servers.some(x => x.id === pv.id));
  card.innerHTML = `<div style="height:64px;${svlBannerCss(pv)}"></div><div style="padding:10px 12px;display:flex;gap:10px;align-items:center">
    <span style="width:38px;height:38px;border-radius:10px;background:var(--accbg,#141d33);display:flex;align-items:center;justify-content:center;font-weight:700;flex:none">${esc(pv.icon || (pv.name || '?')[0].toUpperCase())}</span>
    <div style="flex:1;min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pv.name)}</div><div class="muted small">${Number(pv.member_count) || 0} member${Number(pv.member_count) === 1 ? '' : 's'}</div></div>
    <button class="btn sm primary">${mine ? 'Open' : 'Join'}</button></div>${pv.description ? `<div class="muted small" style="padding:0 12px 10px">${esc(String(pv.description).slice(0, 140))}</div>` : ''}`;
  const btn = card.querySelector('button');
  btn.onclick = async () => {
    btn.disabled = true;
    const { data, error } = await sb.rpc('join_server', { code });
    if (error) { btn.disabled = false; return svlNote(error.message); }
    try {
      if (typeof go === 'function') { svCache = null; go('messages/s/' + data); }
      else { svCache.sid = data; svCache.cid = null; msgMode = 'server'; await loadMessages(); }
    } catch (e) {}
  };
  return card;
}
function invAttach(el) {
  if (el.dataset.inv) return; el.dataset.inv = '1';
  const codes = [...new Set([...(el.textContent || '').matchAll(INV_RE)].map(m => m[1]))].slice(0, 2);
  codes.forEach(c => invCard(c).then(card => { if (card && el.parentNode) el.parentNode.insertBefore(card, el.nextSibling); }));
}
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
  if (n.nodeType !== 1) return;
  if (n.matches && n.matches('.svbody, [data-mid] .body')) invAttach(n);
  if (n.querySelectorAll) n.querySelectorAll('.svbody, [data-mid] .body').forEach(invAttach);
}))).observe(document.body, { childList: true, subtree: true });
const svlInviteLink = code => 'https://auoris.org/invite/' + code;

let svCache = null; // { sid, s, chans, members, roles, mine }
async function svLoadChannels(sid) {
  const s = serverList.find(x => x.id === sid) || null;
  let chans = [], members = [], roles = new Map(), mine = -1, emojis = [], emojiMap = new Map();
  if (s) {
    const [{ data: chansData, error: chErr }, { data: membersData, error: mErr }] = await Promise.all([
      sb.from('channels').select('*').eq('server_id', s.id).order('position').order('created_at'),
      sb.from('server_members').select('user_id, role').eq('server_id', s.id)]);
    if (chErr) throw chErr; if (mErr) throw mErr;
    chans = chansData; members = membersData;
    roles = new Map(members.map(m => [m.user_id, m.role]));
    await getProfiles(members.map(m => m.user_id));
    mine = rankRole(s.myRole);
    ({ list: emojis, map: emojiMap } = await svLoadEmojis(s.id));
  }
  const fresh = s ? await svlLoad(s.id) : { cr: [], cm: new Map() }, spark = s ? await svlSparkLoad(s.id) : null;
  svCache = { sid, s, chans, members, roles, mine, emojis, emojiMap, cr: fresh.cr, cm: fresh.cm, spark };
}
// Local, per-viewer only - which DM/group each visitor has already seen, so the Home list can show unread dots
// without any new server-side "last read" tracking (there isn't one anywhere else in this app either).
const LASTSEEN_KEY = 'auoris_msg_lastseen';
function lastSeenMap() { try { return JSON.parse(localStorage.getItem(LASTSEEN_KEY) || '{}'); } catch { return {}; } }
function markSeen(key) { try { const m = lastSeenMap(); m[key] = Date.now(); localStorage.setItem(LASTSEEN_KEY, JSON.stringify(m)); } catch {} }

function mgRail(mode, sid) {
  $('mgRail').innerHTML = `<button title="Home (DMs & group chats)" id="mgHome" class="${mode === 'home' ? 'on' : ''}">🏠</button><hr>`
    + serverList.map(x => `<button title="${esc(x.name)}" data-s="${x.id}" class="${mode === 'server' && x.id === sid ? 'on' : ''}">${esc(x.icon || [...x.name][0].toUpperCase())}</button>`).join('')
    + '<hr><button title="Create a server" id="svNew">＋</button><button title="Join with an invite code" id="svJoin">🔗</button><button title="Discover public servers" id="svDiscover">🧭</button><button title="Search messages" id="svSearch">🔍</button>';
  $('svDiscover').onclick = mgDiscover;
  $('svSearch').onclick = mgSearch;
  $('mgHome').onclick = () => go('messages');
  $('mgRail').querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('messages/s/' + b.dataset.s));
  $('svNew').onclick = async () => {
    const name = prompt('Server name'); if (!name) return;
    const icon = prompt('Icon (an emoji or a couple of letters, optional)') || null;
    const { data, error } = await sb.rpc('create_server', { name: name.trim().slice(0, 40), icon: icon && icon.trim().slice(0, 8) });
    if (error) return fail(error); svCache = null; go('messages/s/' + data);
  };
  $('svJoin').onclick = async () => {
    const code = prompt('Invite code'); if (!code) return;
    const { data, error } = await sb.rpc('join_server', { code: code.trim() });
    if (error) return fail(error); svCache = null; go('messages/s/' + data);
  };
}
function mgRenderServerShell(sid) {
  const { s, chans, members, mine } = svCache;
  main().innerHTML = `<div class="chat3" id="mg"><div class="rail" id="mgRail"></div><div class="side2" id="mgSide"></div><div class="pane" id="mgPane"></div><div class="members" id="mgMembers"></div></div>`;
  mgRail('server', sid);
  if (!s) {
    $('mg').classList.add('nomembers'); $('mgMembers').remove();
    $('mgSide').innerHTML = '<div class="head">Servers</div><div class="list"><div class="empty">Pick a server, create one with ＋, or join one with an invite code 🔗.</div></div>';
    $('mgPane').innerHTML = `<div class="head">Welcome</div><div class="msgs"><div class="empty">${serverList.length ? 'Choose a server on the left.' : 'You\'re not in any servers yet.'}</div></div>`;
    if (serverList.length && !sid) go('messages/s/' + serverList[0].id);
    return;
  }
  $('mgSide').innerHTML = `${s.banner_path ? `<div style="height:84px;${svlBannerCss(s)}"></div>` : ''}<div class="head"><span style="flex:1">${esc(s.name)}</span>${mine >= 2 ? '<button class="btn sm" id="svSettings" title="Server settings">⚙</button>' : ''}</div>
    <div class="list">${chans.map(x => `<button type="button" class="item" data-c="${x.id}"># ${esc(x.name)}</button>`).join('')}
    ${mine >= 2 ? '<button type="button" class="item" id="chNew">＋ Add channel</button>' : ''}</div>
    <div style="padding:10px;border-top:1px solid var(--border)" class="small muted">Invite code: <b style="color:var(--text)">${esc(s.invite_code)}</b>
      <button class="btn sm" id="svCopy">Copy invite link</button>${s.myRole !== 'owner' ? ' <button class="btn sm danger" id="svLeave">Leave</button>' : ''}${svlSparkHtml(svCache.spark || { count: 0, level: 0 }, 'svSparkBtn')}</div>`;
  $('mgSide').querySelectorAll('[data-c]').forEach(el => el.onclick = () => go(`messages/s/${s.id}/${el.dataset.c}`));
  $('svCopy').onclick = () => { navigator.clipboard.writeText(svlInviteLink(s.invite_code)); toast('Invite link copied - paste it in any chat to show a join card'); };
  if ($('svLeave')) $('svLeave').onclick = async () => {
    if (!confirm(`Leave ${s.name}?`)) return;
    const { error } = await sb.from('server_members').delete().eq('server_id', s.id).eq('user_id', me.id);
    if (error) return fail(error); svCache = null; go('messages');
  };
  if ($('svSparkBtn')) $('svSparkBtn').onclick = () => svlSparkClick(s.id, svCache.spark || {}, () => { svCache = null; route(); });
  if ($('chNew')) $('chNew').onclick = async () => {
    const name = (prompt('Channel name (lowercase letters, numbers, dashes)') || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    const { data, error } = await sb.from('channels').insert({ server_id: s.id, name, position: chans.length }).select().single();
    if (error) return fail(error); svCache = null; go(`messages/s/${s.id}/${data.id}`);
  };
  if ($('svSettings')) $('svSettings').onclick = mgSettings;
  const order = ['owner', 'admin', 'moderator', 'member'], label = { owner: 'Owner', admin: 'Admins', moderator: 'Moderators', member: 'Members' };
  $('mgMembers').innerHTML = order.map(r => {
    const ms = members.filter(m => m.role === r); if (!ms.length) return '';
    return `<h5>${label[r]} — ${ms.length}</h5>` + ms.map(m => { const p = profiles.get(m.user_id);
      return `<div class="item"${who(p, m.role)}>${plainAv(p, 'sm')}<span class="name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;${svlNameColor(m.user_id) ? 'color:' + svlNameColor(m.user_id) : ''}">${esc(dname(p))}${svlBadges(m.user_id)}</span></div>`; }).join('');
  }).join('');
  // role controls live on the profile card, and only for people ranked below you
  profileCardExtra = (uid, box, close) => {
    const { roles, mine, s } = svCache;
    const theirs = roles.get(uid);
    if (!theirs || uid === me.id || mine <= rankRole(theirs) || mine < 1) return;
    const acts = [['kick', 'Kick', 'danger']];
    if (mine >= 2) { if (theirs !== 'moderator') acts.unshift(['moderator', 'Make moderator']); if (theirs !== 'member') acts.unshift(['member', 'Make member']); }
    if (mine >= 3 && theirs !== 'admin') acts.unshift(['admin', 'Make admin']);
    box.innerHTML = acts.map(([a, t, c]) => `<button class="btn sm ${c || ''}" data-act="${a}">${t}</button>`).join('');
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const a = b.dataset.act;
      if (a === 'kick' && !confirm(`Kick @${profiles.get(uid).username} from ${s.name}?`)) return;
      const r = a === 'kick' ? await sb.from('server_members').delete().eq('server_id', s.id).eq('user_id', uid)
        : await sb.rpc('set_member_role', { sid: s.id, target: uid, new_role: a });
      if (r.error) return fail(r.error);
      close(); svCache = null; route();
    });
  };
  pageSubs.push(() => { profileCardExtra = null; });
}
function mgRenderChannel(cid) {
  const { chans, roles, mine } = svCache;
  const c = chans.find(x => x.id === cid) || chans[0];
  $('mgSide').querySelectorAll('[data-c]').forEach(el => el.classList.toggle('on', !!c && el.dataset.c === c.id));
  $('mg').classList.toggle('mob-pane', !!c);
  if (!c) { $('mgPane').innerHTML = '<div class="head">No channels</div><div class="msgs"><div class="empty">This server has no channels yet.</div></div>'; return; }
  chatPane($('mgPane'), {
    title: `# ${esc(c.name)}`, placeholder: `Message #${c.name}`, roleOf: uid => roles.get(uid), table: 'channel_messages',
    pinContext: c.id, canPin: mine >= 1, emojis: () => svCache.emojiMap, schedTarget: c.id,
    activity: () => svCache.members.filter(m => m.user_id !== me.id).map(m => ({ id: m.user_id, name: dname(profiles.get(m.user_id)) })),
    onBack: () => $('mg').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('channel_messages').select('*').eq('channel_id', c.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('ch', 'channel_messages', `channel_id=eq.${c.id}`, add),
    send: async (body, replyTo, atts) => (await sb.from('channel_messages').insert({ channel_id: c.id, sender: me.id, body, reply_to: replyTo ?? null, ...attExtra(atts) })).error,
    canDelete: m => m.sender === me.id || mine >= 1,
    del: async m => (await sb.from('channel_messages').delete().eq('id', m.id)).error,
  });
}
// "You were removed from <group>": remember (per account) which groups were in the last list; one that's gone on a later
// refresh and that we didn't leave ourselves means the owner kicked us (or deleted the group).
const GROUP_MAX = 25, leftByMe = new Set();
function noteRemovedGroups(groups) {
  const key = 'knownGroups.' + me.id;
  let prev = {}; try { prev = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  const now = {}; groups.forEach(g => { now[g.id] = g.name; });
  Object.keys(prev).forEach(id => { if (!now[id] && !leftByMe.has(id)) toast('You were removed from ' + prev[id]); });
  try { localStorage.setItem(key, JSON.stringify(now)); } catch {}
}
// Shared friend picker for groups and AI projects: checkboxes of friends not already in (o.withRole adds a View/Edit select
// per friend). o.add(id, role) does one RPC and returns its error; o.done() re-renders afterwards.
function peoplePicker(pane, o) {
  const cand = acceptedFriends().filter(p => !o.exclude.has(p.id));
  pane.innerHTML = `<div class="head">${esc(o.title)}<span class="sp"></span><button class="btn sm" id="ppBack">Back</button></div><div style="padding:18px;max-width:560px;overflow-y:auto">
    ${o.note ? `<p class="muted small">${esc(o.note)}</p>` : ''}
    ${cand.length ? cand.map(p => `<div class="row" style="align-items:center"><label class="item" style="flex:1"><input type="checkbox" value="${p.id}"> ${plainAv(p, 'sm')} ${esc(dname(p))} <span class="muted small">@${esc(p.username)}</span></label>${o.withRole ? `<select class="in" data-role="${p.id}" style="width:auto"><option value="viewer">View</option><option value="editor">Edit</option></select>` : ''}</div>`).join('')
      : '<div class="empty">All your friends are already here.</div>'}
    <button class="btn primary" id="ppGo" style="margin-top:14px"${cand.length ? '' : ' disabled'}>Add selected</button></div>`;
  $('ppBack').onclick = o.done;
  $('ppGo').onclick = async () => {
    const ids = [...pane.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    if (!ids.length) return;
    if (o.room != null && ids.length > o.room) return toast(`Only ${o.room} more can be added.`);
    $('ppGo').disabled = true;
    for (const id of ids) {
      const sel = pane.querySelector(`select[data-role="${id}"]`);
      const error = await o.add(id, sel ? sel.value : null);
      if (error) { fail(error); break; }
    }
    o.done();
  };
}
// Home: DMs and group chats merged into one list, sorted by most recent activity, newest first.
async function loadHomeList() {
  await loadFriends();
  const acc = acceptedFriends();
  const { data: gm, error } = await sb.from('group_members').select('group_id, group_chats(id,name,owner_id)').eq('user_id', me.id);
  if (error) throw error;
  const groups = gm.filter(x => x.group_chats).map(x => x.group_chats);
  noteRemovedGroups(groups);
  const dmLast = new Map();
  if (acc.length) {
    const { data } = await sb.from('messages').select('sender,recipient,body,attachments,created_at')
      .or(`sender.eq.${me.id},recipient.eq.${me.id}`).order('created_at', { ascending: false }).limit(400);
    (data || []).forEach(m => { const other = m.sender === me.id ? m.recipient : m.sender; if (!dmLast.has(other)) dmLast.set(other, m); });
  }
  const grLast = new Map();
  if (groups.length) {
    const { data } = await sb.from('group_messages').select('group_id,sender,body,attachments,created_at').in('group_id', groups.map(g => g.id)).order('created_at', { ascending: false }).limit(400);
    (data || []).forEach(m => { if (!grLast.has(m.group_id)) grLast.set(m.group_id, m); });
  }
  const seen = lastSeenMap();
  const items = [
    ...acc.map(p => { const m = dmLast.get(p.id); const key = 'dm:' + p.id;
      return { type: 'dm', id: p.id, key, label: dname(p), sub: m ? (m.body || (m.attachments ? '📎 Attachment' : '')) : 'No messages yet', at: m ? m.created_at : null, profile: p,
        unread: !!(m && m.sender !== me.id && new Date(m.created_at).getTime() > (seen[key] || 0)) }; }),
    ...groups.map(g => { const m = grLast.get(g.id); const key = 'g:' + g.id;
      return { type: 'group', id: g.id, key, label: g.name, sub: m ? (m.body || (m.attachments ? '📎 Attachment' : '')) : 'No messages yet', at: m ? m.created_at : null, group: g,
        unread: !!(m && m.sender !== me.id && new Date(m.created_at).getTime() > (seen[key] || 0)) }; }),
  ];
  items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return { items, acc, groups, inc: friends.filter(f => f.status === 'pending' && f.incoming), out: friends.filter(f => f.status === 'pending' && !f.incoming) };
}
async function mgRenderHome(uid, gid) {
  const { items, acc, groups, inc, out } = await loadHomeList();
  main().innerHTML = `<div class="chat3 nomembers" id="mg"><div class="rail" id="mgRail"></div><div class="side2" id="mgSide"></div><div class="pane" id="mgPane"></div></div>`;
  mgRail('home', null);
  $('mgSide').innerHTML = `<div class="head"><span style="flex:1">Messages</span><button class="btn sm" id="gNew" title="New group chat">＋ Group</button></div>
    <form id="addF" style="padding:10px;display:flex;gap:6px"><input class="in" id="addFName" placeholder="Add friend by username" autocomplete="off"><button class="btn sm">Add</button></form>
    <div class="list" id="mgList"></div>`;
  const reqHtml = inc.length ? '<div class="small muted" style="margin:6px 8px">Requests</div>' + inc.map(f => { const p = profiles.get(f.other);
    return `<div class="item">${plainAv(p, 'sm')}<span style="flex:1">${esc(dname(p))}</span><button class="btn sm" data-acc="${f.other}">✓</button><button class="btn sm" data-rm="${f.other}">✕</button></div>`; }).join('') : '';
  const outHtml = out.length ? '<div class="small muted" style="margin:6px 8px">Sent</div>' + out.map(f => { const p = profiles.get(f.other);
    return `<div class="item">${plainAv(p, 'sm')}<span style="flex:1">${esc(dname(p))}</span><button class="btn sm" data-rm="${f.other}">Cancel</button></div>`; }).join('') : '';
  const itemsHtml = items.length
    ? items.map(it => {
        const active = (it.type === 'dm' && it.id === uid) || (it.type === 'group' && it.id === gid);
        const av = it.type === 'dm' ? plainAv(it.profile, 'sm') : `<span class="av sm" style="--c:#5b6b8c">👥</span>`;
        return `<button type="button" class="item ${active ? 'on' : ''}" data-t="${it.type}" data-id="${it.id}">${av}
          <span style="min-width:0;flex:1;overflow:hidden"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label)}</span>
          <span class="muted small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.sub || '')}</span></span>${it.unread ? '<span class="dot"></span>' : ''}</button>`;
      }).join('')
    : '<div class="empty">No DMs or group chats yet. Add a friend, or start a group.</div>';
  $('mgList').innerHTML = reqHtml + itemsHtml + outHtml;
  $('mgList').querySelectorAll('[data-t]').forEach(el => el.onclick = () => go(`messages/${el.dataset.t === 'dm' ? 'dm' : 'g'}/${el.dataset.id}`));
  $('mgList').querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('requester', b.dataset.acc).eq('addressee', me.id);
    if (error) fail(error); route();
  });
  $('mgList').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const id = b.dataset.rm;
    const { error } = await sb.from('friendships').delete().or(`and(requester.eq.${me.id},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me.id})`);
    if (error) fail(error); route();
  });
  $('addF').onsubmit = async e => {
    e.preventDefault();
    const name = $('addFName').value.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return toast('Usernames are 3-20 letters, numbers or _.');
    const { data: p } = await sb.from('profiles').select('id,username').eq('username', name).maybeSingle();
    if (!p) return toast(`No one is called "${name}".`);
    if (p.id === me.id) return toast('That\'s you!');
    const ex = friends.find(f => f.other === p.id);
    if (ex && ex.incoming && ex.status === 'pending') { await sb.from('friendships').update({ status: 'accepted' }).eq('requester', p.id).eq('addressee', me.id); return route(); }
    const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: p.id });
    if (error) return toast(error.code === '23505' ? `You and @${p.username} are already friends or have a pending request.` : error.message);
    toast(`Friend request sent to @${p.username}`); route();
  };
  $('gNew').onclick = () => {
    $('mgPane').innerHTML = `<div class="head">New group chat</div><div style="padding:18px;max-width:460px"><label class="lbl">Name</label><input class="in" id="gName" maxlength="40" placeholder="The squad">
      <label class="lbl">Friends to add (up to 24)</label>${acc.length ? acc.map(p => `<label class="item"><input type="checkbox" value="${p.id}"> ${plainAv(p, 'sm')} ${esc(dname(p))}</label>`).join('') : '<div class="empty">Add some friends first.</div>'}
      <button class="btn primary" id="gCreate" style="margin-top:14px">Create group</button></div>`;
    $('mg').classList.add('mob-pane');
    $('gCreate').onclick = async () => {
      const members = [...$('mgPane').querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
      const name = $('gName').value.trim() || 'Group chat';
      const { data, error } = await sb.rpc('create_group', { name, members });
      if (error) return fail(error); go('messages/g/' + data);
    };
  };
  const p = uid && acc.find(x => x.id === uid);
  const g = gid && groups.find(x => x.id === gid);
  $('mg').classList.toggle('mob-pane', !!(p || g));
  if (!p && !g) { $('mgPane').innerHTML = '<div class="head">Messages</div><div class="msgs"><div class="empty">Pick a DM or group chat, or start a new one.</div></div>'; return; }
  if (p) {
    markSeen('dm:' + p.id);
    chatPane($('mgPane'), {
      title: `${avatar(p, 'sm')} ${nameHtml(p)}`, placeholder: `Message @${p.username}`, table: 'messages',
      pinContext: [me.id, p.id].sort().join(':'), canPin: true, schedTarget: p.id, activity: () => [{ id: p.id, name: dname(p) }],
      onBack: () => $('mg').classList.remove('mob-pane'),
      load: async () => { const { data, error } = await sb.from('messages').select('*').or(`and(sender.eq.${me.id},recipient.eq.${p.id}),and(sender.eq.${p.id},recipient.eq.${me.id})`).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
      subscribe: add => subscribeTable('dm', 'messages', null, m => { if ((m.sender === p.id && m.recipient === me.id) || (m.sender === me.id && m.recipient === p.id)) add(m); }),
      send: async (body, replyTo, atts) => (await sb.from('messages').insert({ sender: me.id, recipient: p.id, body, reply_to: replyTo ?? null, ...attExtra(atts) })).error,
    });
    return;
  }
  markSeen('g:' + g.id);
  const { data: mems } = await sb.from('group_members').select('user_id').eq('group_id', g.id);
  const ps = await getProfiles(mems.map(m => m.user_id));
  chatPane($('mgPane'), {
    title: `👥 ${esc(g.name)} <span class="muted small" style="font-weight:400">· ${mems.map(m => profiles.get(m.user_id)).filter(Boolean).map(p2 => (p2.id === g.owner_id ? '👑 ' : '') + esc(dname(p2))).join(', ')}</span>`,
    headExtra: `<button class="btn sm" id="gMembers">Members (${mems.length})</button><button class="btn sm" id="gAdd">Add people</button><button class="btn sm danger" id="gLeave">Leave</button>`, placeholder: `Message ${g.name}`, table: 'group_messages',
    pinContext: g.id, canPin: true, schedTarget: g.id, activity: () => mems.filter(m => m.user_id !== me.id).map(m => ({ id: m.user_id, name: dname(profiles.get(m.user_id)) })),
    onBack: () => $('mg').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('group_messages').select('*').eq('group_id', g.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('gm', 'group_messages', `group_id=eq.${g.id}`, add),
    send: async (body, replyTo, atts) => (await sb.from('group_messages').insert({ group_id: g.id, sender: me.id, body, reply_to: replyTo ?? null, ...attExtra(atts) })).error,
  });
  const addPeople = () => peoplePicker($('mgPane'), {
    title: 'Add people', exclude: new Set(mems.map(m => m.user_id)), room: GROUP_MAX - mems.length,
    note: `Friends you add can read the whole group. Up to ${GROUP_MAX} people (${mems.length} now).`,
    add: async id => (await sb.rpc('add_group_member', { gid: g.id, target: id })).error, done: () => route(),
  });
  $('gAdd').onclick = addPeople;
  // Member list: crown on the owner; only the owner sees Make owner / Kick (the RPCs enforce it server-side).
  $('gMembers').onclick = () => {
    const isOwner = g.owner_id === me.id;
    $('mgPane').innerHTML = `<div class="head">👥 ${esc(g.name)} · ${mems.length}/${GROUP_MAX}<span class="sp"></span><button class="btn sm" id="gmBack">Back to chat</button></div><div style="padding:18px;max-width:560px;overflow-y:auto">
      ${mems.map(m => { const p2 = profiles.get(m.user_id);
        return `<div class="item" style="cursor:default">${p2 ? avatar(p2, 'sm') : ''} ${p2 ? nameHtml(p2) : 'Unknown'} ${m.user_id === g.owner_id ? '<span class="pill">👑 Owner</span>' : ''}${m.user_id === me.id ? ' <span class="muted small">(you)</span>' : ''}
          ${isOwner && m.user_id !== me.id ? `<span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm" data-own="${m.user_id}">Make owner</button><button class="btn sm danger" data-kick="${m.user_id}">Kick</button></span>` : ''}</div>`; }).join('')}
      <button class="btn sm" id="gmAdd" style="margin-top:12px">Add people</button></div>`;
    $('gmBack').onclick = () => route();
    $('gmAdd').onclick = addPeople;
    const nameOf = uid => { const p2 = profiles.get(uid); return p2 ? dname(p2) : 'this person'; };
    $('mgPane').querySelectorAll('[data-kick]').forEach(b => b.onclick = async () => {
      if (!confirm(`Remove ${nameOf(b.dataset.kick)} from ${g.name}?`)) return;
      const { error } = await sb.rpc('kick_group_member', { gid: g.id, target: b.dataset.kick }); if (error) return fail(error); route();
    });
    $('mgPane').querySelectorAll('[data-own]').forEach(b => b.onclick = async () => {
      if (!confirm(`Make ${nameOf(b.dataset.own)} the owner of ${g.name}? You will lose the ability to remove people.`)) return;
      const { error } = await sb.rpc('transfer_group_owner', { gid: g.id, target: b.dataset.own }); if (error) return fail(error); route();
    });
  };
  $('gLeave').onclick = async () => {
    if (!confirm(`Leave ${g.name}?`)) return;
    const { error } = await sb.from('group_members').delete().eq('group_id', g.id).eq('user_id', me.id);
    if (error) return fail(error); leftByMe.add(g.id); go('messages');
  };
}
PAGES.messages = async (mode, a, b) => {
  await loadServerList();
  if (mode === 's') {
    if (!svCache || svCache.sid !== a) await svLoadChannels(a);
    mgRenderServerShell(a);
    if (svCache.s) mgRenderChannel(b);
    return;
  }
  await mgRenderHome(mode === 'dm' ? a : null, mode === 'g' ? a : null);
};
// Old routes redirect to their Messages equivalent, so any bookmarked/old links still land somewhere sensible.
PAGES.servers = async (sid, cid) => go('messages' + (sid ? `/s/${sid}${cid ? '/' + cid : ''}` : ''));
PAGES.dms = async uid => go('messages' + (uid ? '/dm/' + uid : ''));
PAGES.groups = async gid => go('messages' + (gid ? '/g/' + gid : ''));

// ---- profile
const BANNERS = ['#1c2a52', '#2c1d4f', '#1f3d2b', '#4a1d2b', '#3d2e12', '#12343d', '#2b2b35', '#5b2a86'];
const COLORS = ['#5b9dff', '#8b6bff', '#e5484d', '#f5a524', '#30a46c', '#12a594', '#e93d82', '#8e8c99'];
PAGES.profile = async () => {
  const p = myProfile, plus = isPlus(p), t = plusTier(p);
  const bannerStyle = p.banner_url && plus ? `--bc:url('${encodeURI(p.banner_url)}')` : `--bc:${p.banner_color || '#1c2a52'}`;
  main().innerHTML = `<div class="wrap page"><h1>Profile</h1><p class="lead">How you appear in servers, DMs and the Auoris app.</p>
    <div class="card" style="padding:0;overflow:hidden"><div class="banner ${p.effect === 'aurora' && plus ? 'effect-aurora' : ''}" style="${bannerStyle}"></div>
      <div class="profhead">${avatar(p, 'lg')}<div style="padding-bottom:8px"><h2 style="margin:0">${esc(dname(p))}${badges(p)}</h2><div class="muted">@${esc(p.username)}${p.discord_name ? ` · Discord: ${esc(p.discord_name)}` : ''}</div></div></div>
      <div style="padding:20px 22px">
        ${t ? `<span class="pluspill">${ICON.plus(t.color).replace('<svg', '<svg width="16" height="16"')} Auoris Plus${t.name !== 'Plus' ? ` · ${esc(t.name)}` : ''}${t.months ? ` · ${t.months} months` : ''}</span>` : '<a class="pluspill" href="/plus" style="text-decoration:none;color:var(--muted)">Get Auoris Plus for banners & effects →</a>'}
        <label class="lbl">Display name</label><input class="in" id="pfName" maxlength="40" value="${esc(p.display_name || '')}">
        <label class="lbl">Pronouns</label><input class="in" id="pfPron" maxlength="24" placeholder="e.g. she/her, he/him, they/them" value="${esc(p.pronouns || '')}">
        <label class="lbl">Bio</label><textarea class="in" id="pfBio" maxlength="200" rows="2">${esc(p.bio || '')}</textarea>
        <label class="lbl">Avatar colour</label><div class="swatches" id="pfColor">${COLORS.map(c => `<i style="background:${c}" data-c="${c}" class="${c === p.color ? 'on' : ''}"></i>`).join('')}</div>
        <label class="lbl">Banner colour</label><div class="swatches" id="pfBanner">${BANNERS.map(c => `<i style="background:${c}" data-c="${c}" class="${c === p.banner_color ? 'on' : ''}"></i>`).join('')}</div>
        <div class="${plus ? '' : 'locked'}"><label class="lbl">Banner image URL ${plus ? '' : '(Plus)'}</label><input class="in" id="pfBannerUrl" placeholder="https://…/banner.png" value="${esc(p.banner_url || '')}">
          <label class="lbl">Profile effect ${plus ? '' : '(Plus)'}</label><select class="in" id="pfEffect">${['none', 'aurora', 'sparkle', 'flame', 'glitch'].map(e => `<option ${e === (p.effect || 'none') ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="pfSave">Save profile</button></div>
      </div></div>
</div>`;
  const pick = (id, key) => $(id).querySelectorAll('i').forEach(i => i.onclick = () => { $(id).querySelectorAll('i').forEach(x => x.classList.remove('on')); i.classList.add('on'); pick[key] = i.dataset.c; });
  pick('pfColor', 'color'); pick('pfBanner', 'banner_color');
  $('pfSave').onclick = async () => {
    const patch = { display_name: $('pfName').value.trim() || null, bio: $('pfBio').value.trim() || null, pronouns: $('pfPron').value.trim() || null };
    if (pick.color) patch.color = pick.color;
    if (pick.banner_color) patch.banner_color = pick.banner_color;
    if (plus) {
      const url = $('pfBannerUrl').value.trim();
      if (url && !/^https:\/\/[^\s"'()]+$/i.test(url)) return toast('Banner image must be an https:// link.');
      patch.banner_url = url || null; patch.effect = $('pfEffect').value;
    }
    const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
    if (error) return fail(error);
    Object.assign(myProfile, patch); renderHeader(); toast('Profile saved'); route();
  };
};

// ---- settings
PAGES.settings = async () => {
  main().innerHTML = `<div class="wrap page"><h1>Settings</h1><p class="lead">Account and security. App-only settings (rich presence, AI models, proxy) live in the Auoris app.</p>
    <div class="grid" style="grid-template-columns:1fr">
    <div class="card"><h3 style="margin-top:0">Account</h3><p class="muted">${esc(me.email || '')}</p>
      <label class="lbl">New password</label><div class="row"><input class="in" id="stPass" type="password" autocomplete="new-password" placeholder="8+ characters" style="flex:1"><button class="btn" id="stPassBtn">Change</button></div></div>
    <div class="card" id="stMfa"><h3 style="margin-top:0">Two-factor authentication</h3><p class="muted">Loading…</p></div>
    <div class="card" id="stPriv"><h3 style="margin-top:0">Privacy</h3><p class="muted">Loading…</p></div>
    <div class="card" id="stBlocks"><h3 style="margin-top:0">Blocked &amp; muted</h3><p class="muted">Loading…</p></div>
    <div class="card"><h3 style="margin-top:0">Your data</h3><p class="muted">Download a copy of your profile, friends, the messages you sent, your reactions, your reports and your block list as a JSON file.</p><button class="btn" id="stExport">Download my data</button></div>
    <div class="card"><h3 style="margin-top:0;color:var(--err)">Delete account</h3><p class="muted">Permanently delete your account and data. This can't be undone.</p><button class="btn danger" id="stDelete">Delete my account…</button></div>
    <div class="card"><h3 style="margin-top:0">Sign out</h3><button class="btn danger" id="stOut">Sign out of this browser</button></div></div></div>`;
  $('stPassBtn').onclick = async () => {
    const { error } = await sb.auth.updateUser({ password: $('stPass').value });
    if (error) return fail(error); $('stPass').value = ''; toast('Password changed');
  };
  $('stOut').onclick = () => sb.auth.signOut();
  $('stExport').onclick = e => exportMyData(e.target);
  $('stDelete').onclick = openDeleteAccount;
  renderMfa(); renderPrivacy(); renderBlocked();
};
async function renderPrivacy() {
  const box = $('stPriv'); if (!box) return;
  const { data, error } = await sb.from('profiles').select('dm_policy,friend_request_policy,group_invite_policy').eq('id', me.id).single();
  if (error) { box.innerHTML = `<h3 style="margin-top:0">Privacy</h3><p class="muted">Couldn't load these settings: ${esc(error.message)}</p>`; return; }
  const sel = (key, label, opts) => `<label class="lbl">${label}</label><select class="in" data-k="${key}">${opts.map(([v, l]) => `<option value="${v}"${data[key] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  box.innerHTML = `<h3 style="margin-top:0">Privacy</h3><p class="muted">Choose who can reach you. Changes save instantly. Direct messages also need an accepted friendship.</p>`
    + sel('dm_policy', 'Who can send me direct messages', [['everyone', 'Everyone'], ['friends', 'Friends only'], ['nobody', 'Nobody']])
    + sel('friend_request_policy', 'Who can send me friend requests', [['everyone', 'Everyone'], ['nobody', 'Nobody']])
    + sel('group_invite_policy', 'Who can add me to group chats', [['everyone', 'Everyone'], ['friends', 'Friends only'], ['nobody', 'Nobody']]);
  box.querySelectorAll('select').forEach(s => s.onchange = async () => {
    const { error: e2 } = await sb.from('profiles').update({ [s.dataset.k]: s.value }).eq('id', me.id);
    if (e2) { fail(e2); renderPrivacy(); } else toast('Saved');
  });
}
async function renderBlocked() {
  const box = $('stBlocks'); if (!box) return;
  const ids = [...blocks.keys()];
  await getProfiles(ids);
  box.innerHTML = '<h3 style="margin-top:0">Blocked &amp; muted</h3>' + (ids.length ? ids.map(id => {
    const p = profiles.get(id), isB = blocks.get(id) === 'block';
    return `<div class="row" data-id="${esc(id)}" style="align-items:center;margin-bottom:8px"><b>${esc(dname(p))}</b><span class="muted small">@${esc(p ? p.username : 'unknown')}</span><span class="pill">${isB ? 'Blocked' : 'Muted'}</span><span style="flex:1"></span><button class="btn sm">${isB ? 'Unblock' : 'Unmute'}</button></div>`;
  }).join('') : '<p class="muted">Nobody. Block or mute someone from their profile card.</p>');
  box.querySelectorAll('[data-id] button').forEach(b => b.onclick = async () => { if (await setRelation(b.closest('[data-id]').dataset.id, null)) renderBlocked(); });
}

// ---- download my data: only normal RLS-protected selects (so it can only ever contain what this account may read), paginated
async function pageAll(make, cap = 20000) {
  const out = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
function downloadJson(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportMyData(btn) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Preparing…';
  try {
    const mine = (table, col) => pageAll(() => sb.from(table).select('*').eq(col, me.id).order('id'));
    const [profileRes, friendships, dms, groupMsgs, channelMsgs, projectMsgs, reactions, reports, blockRows] = await Promise.all([
      sb.from('profiles').select('avatar_url,banned,banner_color,banner_url,best_day,bio,color,created_at,discord_name,display_name,dm_policy,effect,friend_request_policy,group_invite_policy,id,is_admin,is_mod,kills,legal_accepted_at,legal_version,plus_since,plus_until,pronouns,staff_since,username').eq('id', me.id).single(),
      pageAll(() => sb.from('friendships').select('*').order('created_at').order('requester')),
      mine('messages', 'sender'), mine('group_messages', 'sender'), mine('channel_messages', 'sender'), mine('ai_project_messages', 'sender'),
      mine('message_reactions', 'user_id'), mine('message_reports', 'reporter'),
      pageAll(() => sb.from('user_blocks').select('*').order('blocked')),
    ]);
    if (profileRes.error) throw profileRes.error;
    await getProfiles(friendships.map(f => f.requester === me.id ? f.addressee : f.requester));
    const nameOf = id => { const q = profiles.get(id); return q ? q.username : null; };
    downloadJson(`auoris-data-${new Date().toISOString().slice(0, 10)}.json`, {
      exported_at: new Date().toISOString(), account: { id: me.id, email: me.email || null }, profile: profileRes.data,
      friends: friendships.map(f => ({ ...f, other_username: nameOf(f.requester === me.id ? f.addressee : f.requester) })),
      messages_sent: { direct_messages: dms, group_messages: groupMsgs, channel_messages: channelMsgs, ai_project_messages: projectMsgs },
      reactions, reports_filed: reports, blocked_and_muted: blockRows,
      notes: 'Up to 20,000 rows per list. Attachments appear as references inside messages; the files themselves are not included.',
    });
    toast('Your data was downloaded.');
  } catch (e) { fail(e); }
  btn.disabled = false; btn.textContent = label;
}

// ---- delete my account (server side: the delete-account Edge Function)
function openDeleteAccount() {
  document.querySelector('.pcard')?.remove();
  const owner = (myProfile.username || '').toLowerCase() === 'auoris', plus = isPlus(myProfile);
  const card = document.createElement('div'); card.className = 'pcard';
  card.innerHTML = `<div class="pcard-in" style="padding:20px;max-height:92vh;overflow:auto"><h3 style="margin:0 0 8px;color:var(--err)">Delete your account?</h3>
    <p class="small" style="margin:0 0 8px"><b>This is permanent and can't be undone.</b></p>
    <p class="small" style="margin:0 0 6px"><b>Deleted:</b> your profile, friends and friend requests, every direct message you sent or received (the other person loses them too), every message you sent in group chats and server channels, your reactions, your blocks and mutes, your uploaded files and profile pictures, and every server, group chat, AI project and hosted server you own (for everyone in them).</p>
    <p class="small" style="margin:0 0 6px"><b>Kept anonymously:</b> messages you wrote in AI projects owned by other people, and abuse reports you filed or that name you.</p>
    <p class="small" style="margin:0 0 6px"><b>Auoris Plus:</b> if you have an active subscription, deleting your account cancels it right away. There is no refund for the current period.</p>
    ${owner ? '<p class="small" style="color:var(--err)">The Owner account can\'t be deleted.</p>' : `<label class="lbl">Type your username (<b>${esc(myProfile.username)}</b>) to confirm</label><input class="in" id="dlName" autocomplete="off">`}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="dlCancel">Cancel</button>${owner ? '' : '<button class="btn danger" id="dlGo" disabled>Delete forever</button>'}</div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  card.querySelector('#dlCancel').onclick = () => card.remove();
  if (owner) return;
  const name = card.querySelector('#dlName'), go2 = card.querySelector('#dlGo');
  name.oninput = () => { go2.disabled = name.value.trim().toLowerCase() !== myProfile.username.toLowerCase(); };
  go2.onclick = async () => {
    go2.disabled = true; go2.textContent = 'Deleting…';
    const { data, error } = await sb.functions.invoke('delete-account', { body: { confirm_username: name.value.trim() } });
    if (error || !data || !data.ok) { go2.disabled = false; go2.textContent = 'Delete forever'; return toast(error ? await fnError(error) : ((data && data.error) || 'Something went wrong.')); }
    card.remove();
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    toast('Your account has been deleted.');
  };
}
async function renderMfa() {
  const box = $('stMfa'); if (!box) return;
  const { data } = await sb.auth.mfa.listFactors();
  const on = data && data.totp.find(f => f.status === 'verified');
  if (on) {
    box.innerHTML = '<h3 style="margin-top:0">Two-factor authentication <span style="color:var(--ok)">● On</span></h3><p class="muted">You\'re asked for a code each time you sign in.</p><button class="btn" id="mfaOff">Turn off</button>';
    $('mfaOff').onclick = async () => { const { error } = await sb.auth.mfa.unenroll({ factorId: on.id }); if (error) fail(error); renderMfa(); };
    return;
  }
  box.innerHTML = '<h3 style="margin-top:0">Two-factor authentication</h3><p class="muted">Use a code from an authenticator app when you sign in.</p><button class="btn" id="mfaOn">Set up 2FA</button>';
  $('mfaOn').onclick = async () => {
    for (const f of (data && data.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data: en, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Auoris web ' + Date.now() });
    if (error) return fail(error);
    box.innerHTML = `<h3 style="margin-top:0">Scan with your authenticator app</h3><img id="mfaQr" alt="QR code" style="background:#fff;border-radius:10px;padding:8px;width:180px">
      <p class="muted small">Or type this key: <code>${esc(en.totp.secret)}</code></p><div class="row"><input class="in" id="mfaCode" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="max-width:180px"><button class="btn primary" id="mfaVerify">Turn on</button></div>`;
    $('mfaQr').src = en.totp.qr_code;
    $('mfaVerify').onclick = async () => {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: en.id, code: $('mfaCode').value.trim() });
      if (error) return fail(error); toast('2FA is on'); renderMfa();
    };
  };
}

// ---- admin panel (visible only to admins; owner - the "Auoris" account - additionally gets admin_set_admin)
PAGES.admin = async () => {
  if (!myProfile.is_admin) { toast("You don't have admin access."); return go(''); }
  const isOwner = (myProfile.username || '').toLowerCase() === 'auoris';
  main().innerHTML = `<div class="wrap page"><h1>Admin</h1>
    <h2 style="margin:0 0 10px;font-size:18px">Reports</h2><div id="adReports" style="margin-bottom:26px"><div class="empty">Loading…</div></div>
    <h2 style="margin:0 0 6px;font-size:18px">Accounts</h2><p class="lead">Search a username to moderate their account.</p>
    <div class="row" style="margin-bottom:16px"><input class="in" id="adQ" placeholder="Search username…" style="max-width:320px" autocomplete="off"></div>
    <div id="adBody"><div class="empty">Type a username, or leave it blank for the most recent accounts.</div></div></div>`;
  const cols = 'id,username,display_name,is_admin,is_mod,banned,plus_until';
  const row = p => `<div class="card" data-id="${esc(p.id)}" style="margin-bottom:10px">
    <div class="row" style="align-items:center;flex-wrap:wrap">
      <b>${esc(p.display_name || p.username)}</b><span class="muted small">@${esc(p.username)}</span>
      ${p.is_admin ? '<span class="pill">Admin</span>' : ''}${p.is_mod ? '<span class="pill">Moderator</span>' : ''}
      ${p.banned ? '<span class="pill" style="color:var(--err)">Banned</span>' : ''}${isPlus(p) ? '<span class="pill" style="color:var(--acc2)">Plus</span>' : ''}
      <span style="flex:1"></span>
      <button class="btn sm" data-a="mod">${p.is_mod ? 'Remove mod' : 'Make mod'}</button>
      <button class="btn sm" data-a="plus3">+3mo Plus</button>
      <button class="btn sm" data-a="unplus">Clear Plus</button>
      ${isOwner ? `<button class="btn sm" data-a="admin">${p.is_admin ? 'Remove admin' : 'Make admin'}</button>` : ''}
      <button class="btn sm danger" data-a="ban">${p.banned ? 'Unban' : 'Ban'}</button>
    </div></div>`;
  async function search(q) {
    const query = sb.from('profiles').select(cols).order('created_at', { ascending: false }).limit(30);
    const { data, error } = q ? await query.ilike('username', `%${q}%`) : await query;
    if (error) { $('adBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    $('adBody').innerHTML = data.length ? data.map(row).join('') : '<div class="empty">No matches.</div>';
    $('adBody').querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
      const id = btn.closest('[data-id]').dataset.id, a = btn.dataset.a;
      btn.disabled = true;
      try {
        if (a === 'ban') { const { data: cur } = await sb.from('profiles').select('banned').eq('id', id).single();
          const { error } = await sb.rpc('admin_set_banned', { target: id, value: !cur.banned }); if (error) throw error; }
        if (a === 'mod') { const { data: cur } = await sb.from('profiles').select('is_mod').eq('id', id).single();
          const { error } = await sb.rpc('admin_set_mod', { target: id, value: !cur.is_mod }); if (error) throw error; }
        if (a === 'admin') { const { data: cur } = await sb.from('profiles').select('is_admin').eq('id', id).single();
          const { error } = await sb.rpc('admin_set_admin', { target: id, value: !cur.is_admin }); if (error) throw error; }
        if (a === 'plus3') { const { error } = await sb.rpc('admin_set_plus', { target: id, n_months: 3 }); if (error) throw error; }
        if (a === 'unplus') { const { error } = await sb.rpc('admin_set_plus', { target: id, n_months: 0 }); if (error) throw error; }
        search($('adQ').value.trim());
      } catch (e) { fail(e); btn.disabled = false; }
    });
  }
  let t;
  $('adQ').oninput = () => { clearTimeout(t); t = setTimeout(() => search($('adQ').value.trim()), 250); };
  search('');
  async function loadReports() {
    const box = $('adReports'); if (!box) return;
    const { data, error } = await sb.from('message_reports').select('*').in('status', ['open', 'reviewing']).order('created_at', { ascending: false }).limit(50);
    if (error) { box.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    await getProfiles(data.flatMap(r => [r.reporter, r.reported_user]).filter(Boolean));
    const nm = id => id ? '@' + esc((profiles.get(id) || {}).username || 'unknown') : 'a deleted account';
    box.innerHTML = data.length ? data.map(r => {
      const s = r.snapshot || {}, atts = Array.isArray(s.attachments) ? s.attachments : [];
      return `<div class="card" data-rid="${r.id}" data-target="${esc(r.reported_user || '')}" style="margin-bottom:10px">
        <div class="row" style="align-items:center;flex-wrap:wrap"><span class="pill" style="color:var(--err)">${esc((REPORT_REASONS.find(x => x[0] === r.reason) || [0, r.reason])[1])}</span>
          <span class="pill">${esc(REPORT_TABLE_LABEL[r.message_table] || r.message_table)}</span><span class="muted small">${esc(new Date(r.created_at).toLocaleString())}</span></div>
        <p class="small" style="margin:8px 0 4px">${nm(r.reported_user)} was reported by ${nm(r.reporter)}</p>
        <div style="background:var(--panel2);border-radius:10px;padding:8px 10px;white-space:pre-wrap;word-break:break-word">${esc(s.body || '(no text)')}</div>
        ${atts.length ? `<p class="muted small" style="margin:6px 0 0">Attachments: ${atts.map(esc).join(', ')}</p>` : ''}
        ${r.note ? `<p class="small" style="margin:6px 0 0"><b>Note:</b> ${esc(r.note)}</p>` : ''}
        <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn sm" data-ra="dismissed">Dismiss</button><button class="btn sm" data-ra="actioned">Mark actioned</button>
          ${r.reported_user ? '<button class="btn sm danger" data-ra="ban">Ban user</button>' : ''}</div></div>`;
    }).join('') : '<div class="empty">No open reports.</div>';
    box.querySelectorAll('[data-ra]').forEach(btn => btn.onclick = async () => {
      const card = btn.closest('[data-rid]'), id = card.dataset.rid, a = btn.dataset.ra;
      if (a === 'ban' && !confirm('Ban this user and mark the report actioned?')) return;
      btn.disabled = true;
      try {
        if (a === 'ban') { const { error: e1 } = await sb.rpc('admin_set_banned', { target: card.dataset.target, value: true }); if (e1) throw e1; }
        const { error: e2 } = await sb.from('message_reports').update({ status: a === 'dismissed' ? 'dismissed' : 'actioned' }).eq('id', id); if (e2) throw e2;
        loadReports(); search($('adQ').value.trim());
      } catch (e) { fail(e); btn.disabled = false; }
    });
  }
  loadReports();
};

// ---- AI providers
PAGES.ai = async () => {
  const plus = isPlus(myProfile);
  const provs = [['Anthropic', 'Claude models'], ['OpenAI', 'GPT models'], ['Google', 'Gemini'], ['OpenRouter', 'Hundreds of models, one key'], ['Groq', 'Very fast open models'],
    ['Mistral', 'Mistral & Codestral'], ['xAI', 'Grok'], ['DeepSeek', 'DeepSeek chat & reasoner'], ['Ollama', 'Free local models on your PC']];
  main().innerHTML = `<div class="wrap page"><h1>AI Providers</h1><p class="lead">Local Ollama models are free for everyone. Cloud providers with your own API keys are an Auoris Plus feature,
    set up in the app under Settings → AI Providers. Your keys are encrypted on your PC and never uploaded.</p>
    <div class="card" style="margin-bottom:16px">${plus ? '✅ You have Plus - AI Providers are unlocked in your app.' : 'You\'re on the free plan. <a href="/plus">Get Plus</a> to use cloud providers.'}</div>
    <div class="grid">${provs.map(([n, d]) => `<div class="card feat"><h3 style="margin-top:0">${n}</h3><p>${d}${n === 'Ollama' ? ' · free' : ' · Plus'}</p></div>`).join('')}</div></div>`;
};

// ---- hosting
const GAMES = { minecraft: ['⛏️', 'Minecraft'], terraria: ['🌳', 'Terraria'], valheim: ['🪓', 'Valheim'], palworld: ['🐾', 'Palworld'],
  rust: ['🛢️', 'Rust'], factorio: ['⚙️', 'Factorio'], '7dtd': ['🧟', '7 Days to Die'], ark: ['🦖', 'ARK'] };
PAGES.hosting = async () => {
  const plus = isPlus(myProfile);
  const { data: rows, error } = await sb.from('hosted_servers').select('*').order('created_at');
  if (error) throw error;
  main().innerHTML = `<div class="wrap page"><h1>Hosting</h1><p class="lead">Game servers at <b>yourname.servers.auoris.org</b>, managed from Auoris. Plus includes up to 3.</p>
    <div class="card" style="margin-bottom:16px;border-color:#fbbf5a55">🚧 Server provisioning isn't live yet. Creating a server now reserves its name, and it starts automatically when hosting launches.</div>
    <div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">Your servers (${rows.length}/3)</h3>
      ${rows.length ? rows.map(h => `<div class="srv" style="padding:10px 0;border-top:1px solid var(--border)"><span class="gameic">${GAMES[h.game][0]}</span>
        <div style="flex:1"><b>${esc(h.name)}.servers.auoris.org</b><div class="muted small">${GAMES[h.game][1]} · created ${new Date(h.created_at).toLocaleDateString()}</div></div>
        <span class="status ${h.status}">${h.status}</span><button class="btn sm" data-copy="${esc(h.name)}.servers.auoris.org">Copy address</button><button class="btn sm danger" data-del="${h.id}">Delete</button></div>`).join('')
        : '<div class="empty">No servers yet.</div>'}</div>
    <div class="card ${plus ? '' : 'locked'}"><h3 style="margin-top:0">New server ${plus ? '' : '(Plus)'}</h3>
      <label class="lbl">Game</label><select class="in" id="hGame">${Object.entries(GAMES).map(([k, [ic, n]]) => `<option value="${k}">${ic} ${n}</option>`).join('')}</select>
      <label class="lbl">Address</label><div class="row"><input class="in" id="hName" maxlength="31" placeholder="myserver" style="flex:1;max-width:260px"><span class="muted">.servers.auoris.org</span></div>
      <button class="btn primary" id="hCreate" style="margin-top:14px" ${rows.length >= 3 ? 'disabled' : ''}>Create server</button></div>
    ${plus ? '' : '<p style="margin-top:14px"><a class="btn primary" href="/plus">Get Plus to host servers</a></p>'}</div>`;
  main().querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Address copied'); });
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this server and free up its name?')) return;
    const { error } = await sb.from('hosted_servers').delete().eq('id', b.dataset.del); if (error) return fail(error); route();
  });
  $('hCreate').onclick = async () => {
    const name = $('hName').value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(name)) return toast('Use 3-31 lowercase letters, numbers or dashes.');
    const { error } = await sb.rpc('create_hosted_server', { name, game: $('hGame').value });
    if (error) return fail(error.code === '23505' ? 'That address is taken.' : error); route();
  };
};

// ---- local AI (chat with the signed-in PC's own model - Ollama, or whatever cloud model it has picked - over
// the LAN). This is the one Auoris feature that genuinely needs a nearby PC: everything else in this app talks
// to Supabase directly, the same way the desktop app's account features and this site already do, so it works
// over cellular data with no PC anywhere nearby. Pairing reuses the exact QR code the desktop app already shows
// under profile → Phone app (account.PhoneServer) - we don't add a second pairing mechanism, we just also let
// this page's camera read that same code, in addition to a phone's own camera app (which still works too and
// needs nothing from this page at all).
const PC_KEY = 'auoris_pc_url';
const pcUrl = () => { try { return localStorage.getItem(PC_KEY) || ''; } catch { return ''; } };
const setPcUrl = u => { try { u ? localStorage.setItem(PC_KEY, u) : localStorage.removeItem(PC_KEY); } catch {} };
PAGES.localai = async () => {
  const saved = pcUrl();
  main().innerHTML = `<div class="wrap page" style="max-width:640px"><h1>Local AI</h1>
    <p class="lead">Chat with your PC's own AI model. It's the one thing here that needs your PC turned on and on the same Wi-Fi - everything else in Auoris (Messages, Projects, Hosting, Plus${me && myProfile && myProfile.is_admin ? ', Admin' : ''}) works from anywhere, cellular data included.</p>
    <div class="card">
      <h3 style="margin-top:0">${saved ? '✅ Paired with a PC' : 'Pair with your PC'}</h3>
      ${saved ? `<p class="muted small" style="word-break:break-all">${esc(saved.split('#')[0])}</p>
        <div class="row"><a class="btn primary" href="${esc(saved)}">Open Local AI chat →</a><button class="btn" id="pcRescan">Re-pair</button><button class="btn danger" id="pcForget">Forget this PC</button></div>`
        : `<p class="muted">On your PC, open Auoris → the profile menu (top right) → <b>Phone app</b>, and switch on "Allow phone access" - it shows a QR code. Then either:</p>
        <ol class="steps"><li>Tap <b>Scan QR code</b> below (fastest, works right here in the app), or</li>
        <li>Point your phone's normal <b>camera app</b> at that same QR code instead - it opens the chat directly, no install needed.</li></ol>
        <div class="row"><button class="btn primary" id="pcScan">📷 Scan QR code</button></div>
        <div id="pcScanBox" hidden style="margin-top:14px"></div>
        <p class="muted small" id="pcScanMsg" style="margin-top:10px"></p>
        <p class="muted small" style="margin-top:14px">⚠ Camera-based scanning needs a browser that supports it (recent Chrome/Edge on Android; not all iOS browsers). The camera-app method above always works.</p>`}
    </div></div>`;
  if ($('pcForget')) $('pcForget').onclick = () => { setPcUrl(''); route(); };
  if ($('pcRescan')) $('pcRescan').onclick = () => { setPcUrl(''); route(); };
  if ($('pcScan')) $('pcScan').onclick = () => startPcScan();
};
async function startPcScan() {
  const box = $('pcScanBox'), msg = $('pcScanMsg');
  if (!('BarcodeDetector' in window)) { msg.textContent = "This browser can't scan in-page - use the camera app on the QR code instead."; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { msg.textContent = 'Camera access was blocked - use the camera app on the QR code instead.'; return; }
  box.hidden = false;
  box.innerHTML = '<video playsinline autoplay muted style="width:100%;border-radius:12px;background:#000;display:block"></video>';
  const video = box.querySelector('video');
  video.srcObject = stream;
  let stopped = false;
  const stopScan = () => { if (stopped) return; stopped = true; stream.getTracks().forEach(t => t.stop()); };
  pageSubs.push(stopScan);  // camera stops if the visitor navigates away mid-scan
  let detector;
  try { detector = new BarcodeDetector({ formats: ['qr_code'] }); }
  catch { msg.textContent = "This browser can't scan in-page - use the camera app on the QR code instead."; stopScan(); return; }
  (async function loop() {
    while (!stopped) {
      try {
        const codes = await detector.detect(video);
        const hit = codes.find(c => /^https?:\/\//.test(c.rawValue));
        if (hit) {
          stopScan();
          setPcUrl(hit.rawValue);
          toast("Paired! Opening your PC's chat…");
          location.href = hit.rawValue;  // hands off to mobile.html, served by the PC itself
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 350));
    }
  })();
}

// ---- plus
PAGES.plus = async () => {
  const p = myProfile, t = plusTier(p);
  const perks = [['🖼', 'Custom banners & profile images', 'Free accounts keep banner colours.'], ['✨', 'Profile effects', 'Aurora, sparkle, flame and more.'],
    ['🌐', 'Browser proxy', 'Route the built-in browser through a proxy.'], ['🧠', 'AI Providers', 'Use Claude, GPT, Gemini and more with your own keys.'],
    ['🎮', 'Gaming boost', 'FPS, ping and background-load tuning in the app.'], ['🖥', 'Hosting', 'Up to 3 game servers on servers.auoris.org.']];
  main().innerHTML = `<div class="wrap page"><div class="plushero">${ICON.plus('#ffffff')}<h1 style="margin-top:14px">Auoris Plus</h1>
    <div class="price">$19.99<small> / month</small></div><p class="muted">Cancel anytime.</p>
    <div class="row" style="justify-content:center;margin-top:18px">${t ? `<span class="pluspill">${ICON.check('#2ecc71').replace('<svg', '<svg width="16" height="16"')} You have Plus${t.name !== 'Plus' ? ` · ${esc(t.name)}` : ''}${t.months ? ` · ${t.months} months` : ''}</span><button class="btn" id="plusManage">Manage subscription</button>`
      : `<button class="btn primary" id="plusBuy">${me ? 'Subscribe' : 'Sign in to subscribe'}</button>`}</div></div>
    <div class="grid">${perks.map(([i, h, d]) => `<div class="card feat"><div class="ic">${i}</div><h3>${h}</h3><p>${d}</p></div>`).join('')}</div>
    <h2 style="margin:40px 0 6px">Your Plus badge grows with you</h2><p class="muted" style="margin:0 0 18px">The sun-and-asteroid badge next to your name changes colour the longer you stay subscribed.</p>
    <div class="ladder"><div>${ICON.plus('#ffffff')}<b>Plus</b><span>from day one</span></div>
      ${TIERS.slice().reverse().map(([m, n, c]) => `<div>${ICON.plus(c)}<b style="color:${c}">${n}</b><span>${m} months</span></div>`).join('')}</div>
    ${me ? `<div class="card" style="margin-top:40px"><h3 style="margin-top:0">🎁 Gift Auoris Plus</h3><p class="muted">Give a friend Plus - a one-time payment, no subscription for them to manage.</p>
      <div id="giftBox"></div></div>` : ''}</div>`;
  if ($('plusBuy')) $('plusBuy').onclick = async () => {
    if (!me) return go('signin');
    const { data, error } = await sb.functions.invoke('stripe-checkout', { body: { action: 'checkout', return_url: location.origin + '/plus' } });
    if (error || !data || !data.url) return toast('Checkout isn\'t live yet - check back soon.');
    location.href = data.url;
  };
  if ($('plusManage')) $('plusManage').onclick = async () => {
    const { data, error } = await sb.functions.invoke('stripe-checkout', { body: { action: 'portal', return_url: location.origin + '/plus' } });
    if (error || !data || !data.url) return toast('Subscription management isn\'t live yet.');
    location.href = data.url;
  };
  if ($('giftBox')) {
    await loadFriends();
    const acc = acceptedFriends();
    $('giftBox').innerHTML = acc.length ? `<div class="row">
      <select class="in" id="giftWho" style="max-width:220px">${acc.map(f => `<option value="${f.id}">@${esc(f.username)}</option>`).join('')}</select>
      <select class="in" id="giftLen" style="max-width:160px"><option value="1">1 month · $19.99</option><option value="3">3 months · $49.99</option><option value="12">12 months · $179.99</option></select>
      <button class="btn primary" id="giftBtn">Send gift</button></div>` : '<div class="empty">Add a friend first to gift them Plus.</div>';
    if ($('giftBtn')) $('giftBtn').onclick = async () => {
      const recipient_id = $('giftWho').value, months = $('giftLen').value;
      const { data, error } = await sb.functions.invoke('stripe-checkout', { body: { action: 'gift', recipient_id, months, return_url: location.origin + '/plus' } });
      if (error || !data || !data.url) return toast('Gifting isn\'t live yet - check back soon.');
      location.href = data.url;
    };
  }
};

// ---- AI collaboration projects
const KEY_MODES = { own: 'Everyone uses their own API key (in their Auoris app)', creator_key: 'Use my API key for everyone (it\'s never shown to anyone)', shared_model: 'Everyone runs the same model themselves (e.g. a local Ollama model)' };
const PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'groq', 'mistral', 'xai', 'deepseek', 'ollama'];
PAGES.projects = async pid => {
  await loadFriends();
  const { data: pm, error } = await sb.from('ai_project_members').select('role, ai_projects(*)').eq('user_id', me.id);
  if (error) throw error;
  const projects = pm.filter(x => x.ai_projects).map(x => ({ ...x.ai_projects, myRole: x.role }));
  main().innerHTML = `<div class="chat2" id="pr"><div class="side2"><div class="head"><span style="flex:1">AI projects</span><button class="btn sm" id="pNew">＋ New</button></div>
    <div class="list">${projects.length ? projects.map(x => `<button type="button" class="item ${x.id === pid ? 'on' : ''}" data-p="${x.id}">🤝 ${esc(x.name)}</button>`).join('') : '<div class="empty">No projects yet.</div>'}</div></div>
    <div class="pane" id="pPane"></div></div>`;
  main().querySelectorAll('[data-p]').forEach(el => el.onclick = () => go('projects/' + el.dataset.p));
  $('pNew').onclick = () => {
    $('pPane').innerHTML = `<div class="head">New AI project</div><div style="padding:18px;max-width:560px;overflow-y:auto">
      <label class="lbl">Name</label><input class="in" id="npName" maxlength="60" placeholder="Minecraft mod helper">
      <label class="lbl">What's it for?</label><textarea class="in" id="npDesc" maxlength="500" rows="2"></textarea>
      <div class="row"><div style="flex:1"><label class="lbl">Provider</label><select class="in" id="npProv">${PROVIDERS.map(x => `<option>${x}</option>`).join('')}</select></div>
        <div style="flex:2"><label class="lbl">Model</label><input class="in" id="npModel" maxlength="120" placeholder="e.g. claude-sonnet-5 or llama3.1"></div></div>
      <label class="lbl">API keys</label>${Object.entries(KEY_MODES).map(([k, v], i) => `<label class="item"><input type="radio" name="npMode" value="${k}" ${i ? '' : 'checked'}> ${esc(v)}</label>`).join('')}
      <button class="btn primary" id="npCreate" style="margin-top:14px">Create project</button></div>`;
    $('npCreate').onclick = async () => {
      const { data, error } = await sb.rpc('create_ai_project', { name: $('npName').value.trim() || 'Untitled project', description: $('npDesc').value.trim() || null,
        provider: $('npProv').value, model: $('npModel').value.trim() || null, key_mode: document.querySelector('input[name=npMode]:checked').value });
      if (error) return fail(error); go('projects/' + data);
    };
  };
  const x = projects.find(p => p.id === pid);
  $('pr').classList.toggle('mob-pane', !!x);
  if (!x) { $('pPane').innerHTML = '<div class="head">AI projects</div><div class="msgs"><div class="empty">Shared AI projects with friends. Pick one or make a new one.</div></div>'; return; }
  const { data: mems } = await sb.from('ai_project_members').select('user_id, role').eq('project_id', x.id);
  await getProfiles(mems.map(m => m.user_id));
  const mineM = mems.find(m => m.user_id === me.id); if (mineM) x.myRole = mineM.role;  // fresh role (it may have changed since the list loaded)
  const owner = x.myRole === 'owner', canManage = ['owner', 'editor'].includes(x.myRole);
  const addPeople = () => peoplePicker($('pPane'), {
    title: 'Add people', withRole: true, exclude: new Set(mems.map(m => m.user_id)),
    note: 'View: can read the conversation. Edit: can also post and add people.',
    add: async (id, role) => (await sb.rpc('add_project_member', { pid: x.id, target: id, new_role: role || 'viewer' })).error, done: () => route(),
  });
  chatPane($('pPane'), {
    readOnly: x.myRole === 'viewer',
    title: `🤝 ${esc(x.name)} <span class="muted small" style="font-weight:400">· ${esc(x.provider || '')}${x.model ? ' / ' + esc(x.model) : ''} · ${mems.length} member${mems.length === 1 ? '' : 's'}</span>`,
    headExtra: `${canManage ? '<button class="btn sm" id="pAddPeople">Add people</button>' : ''}<button class="btn sm" id="pInfo">Project</button>`, placeholder: `Message ${x.name}`, reportTable: 'ai_project_messages', emptyText: 'Start the conversation - everyone in the project sees it.',
    onBack: () => $('pr').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('ai_project_messages').select('*').eq('project_id', x.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('pm', 'ai_project_messages', `project_id=eq.${x.id}`, add),
    send: async body => {
      const err = (await sb.from('ai_project_messages').insert({ project_id: x.id, sender: me.id, body })).error;
      if (!err && x.key_mode === 'creator_key') sb.functions.invoke('ai-project-reply', { body: { project_id: x.id } }).then(({ error }) => { if (error) toast('The AI couldn\'t reply yet - project replies are switching on soon.'); });
      return err;
    },
  });
  if ($('pAddPeople')) $('pAddPeople').onclick = addPeople;
  $('pInfo').onclick = () => {
    $('pPane').innerHTML = `<div class="head">🤝 ${esc(x.name)}<span class="sp"></span><button class="btn sm" id="pBack">Back to chat</button></div><div style="padding:18px;max-width:620px;overflow-y:auto">
      <p class="muted">${esc(x.description || '')}</p>
      <p><b>API keys:</b> ${esc(KEY_MODES[x.key_mode])}</p>
      ${x.key_mode === 'creator_key' ? (owner ? `<div class="card"><b>Your API key</b> <span class="muted small">${x.has_creator_key ? '· saved - it can\'t be viewed, only replaced or removed' : '· not set yet'}</span>
          <div class="row" style="margin-top:10px"><input class="in" id="pKey" type="password" autocomplete="off" placeholder="Paste a new key" style="flex:1"><button class="btn primary" id="pKeySave">Save key</button>${x.has_creator_key ? '<button class="btn danger" id="pKeyDel">Remove</button>' : ''}</div>
          <p class="muted small">Stored encrypted on the server and only used to answer this project. No one - including you - can read it back.</p></div>`
        : `<p class="muted">${x.has_creator_key ? 'The creator\'s key is set - AI replies here use it. You never see it.' : 'Waiting for the creator to add a key.'}</p>`) : ''}
      ${x.key_mode !== 'creator_key' ? '<p class="muted small">AI replies are made from each member\'s Auoris app - open this project in the app to reply with your model.</p>' : ''}
      <h3>Members</h3>${mems.map(m => { const p = profiles.get(m.user_id), isMe = m.user_id === me.id;
        // Owner manages everyone; editors can add/promote viewers and remove viewers (demoting/removing an editor is owner-only).
        const manage = canManage && m.role !== 'owner' && !isMe && (owner || m.role === 'viewer');
        return `<div class="item" style="cursor:default">${avatar(p, 'sm')} ${nameHtml(p)}${isMe ? ' <span class="muted small">(you)</span>' : ''}<span style="margin-left:auto;display:flex;gap:6px;align-items:center">${manage
          ? `<select class="in" data-rolesel="${m.user_id}" style="width:auto"><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>View</option><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Edit</option></select><button class="btn sm danger" data-rm="${m.user_id}">Remove</button>`
          : `<span class="muted small">${esc(({ owner: 'Owner', editor: 'Can edit', viewer: 'View only' })[m.role] || m.role)}</span>`}</span></div>`; }).join('')}
      ${canManage ? '<div class="row" style="margin-top:10px"><button class="btn" id="pAdd">Add people</button></div>' : ''}
      <div class="row" style="margin-top:22px">${owner ? '<button class="btn danger" id="pDel">Delete project</button>' : '<button class="btn danger" id="pLeave">Leave project</button>'}</div></div>`;
    $('pBack').onclick = () => route();
    if ($('pKeySave')) $('pKeySave').onclick = async () => {
      const key = $('pKey').value.trim(); $('pKey').value = '';
      const { error } = await sb.rpc('set_project_key', { pid: x.id, api_key: key }); if (error) return fail(error); toast('Key saved - it can\'t be viewed again'); route();
    };
    if ($('pKeyDel')) $('pKeyDel').onclick = async () => { const { error } = await sb.rpc('clear_project_key', { pid: x.id }); if (error) return fail(error); route(); };
    if ($('pAdd')) $('pAdd').onclick = addPeople;
    $('pPane').querySelectorAll('[data-rolesel]').forEach(sel => sel.onchange = async () => {
      const { error } = await sb.rpc('set_project_member_role', { pid: x.id, target: sel.dataset.rolesel, new_role: sel.value }); if (error) fail(error); route();
    });
    $('pPane').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this person from the project?')) return;
      const { error } = await sb.rpc('remove_project_member', { pid: x.id, target: b.dataset.rm }); if (error) fail(error); route();
    });
    if ($('pDel')) $('pDel').onclick = async () => { if (!confirm('Delete this project for everyone?')) return; const { error } = await sb.from('ai_projects').delete().eq('id', x.id); if (error) return fail(error); go('projects'); };
    if ($('pLeave')) $('pLeave').onclick = async () => { const { error } = await sb.from('ai_project_members').delete().eq('project_id', x.id).eq('user_id', me.id); if (error) return fail(error); go('projects'); };
  };
};

// ---------------------------------------------------------------- boot
sb.auth.onAuthStateChange(ev => {
  if (ev !== 'SIGNED_OUT') return;
  me = myProfile = null; gifFavs = null; renderHeader();
  if (document.getElementById('authForm')) authShow('login'); else go('');   // on the sign-in page, stay on it
});
window.addEventListener('popstate', route);
// Re-run the current page when the tab comes back (switching browser tabs/apps and back, or the page being
// restored from the browser's back/forward cache) instead of leaving whatever was last rendered on screen -
// otherwise switching away and back shows stale data until a manual reload.
let lastRouteAt = Date.now();
const realRoute = route;
route = async (...a) => { lastRouteAt = Date.now(); return realRoute(...a); };
window.addEventListener('pageshow', e => { if (e.persisted) route(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRouteAt > 15000) route();
});
// Intercept same-origin path links (href="/...") so they route client-side instead of hitting GitHub Pages'
// server (which has no real file at e.g. /servers - only index.html exists). Plain "#..." in-page anchors like
// the Download button's href="#dl", and external/absolute links, are left alone to behave natively.
document.addEventListener('click', e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href^="/"]');
  if (!a || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href').replace(/^\/+/, ''));
});
// ================================================================ WAVE 2 (client-only): command palette, theme presets, typing indicators, "sign out everywhere else".
// Self-contained block (desktop-only in ui.html: custom CSS, quiet hours/DND, screen sharing). Wraps renderHeader / PAGES.settings / loadHomeList, and
// uses event delegation for the composer, so nothing in chatPane had to change. localStorage keys: auoris_theme, auoris_typing_share.
(() => {
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---- theme presets (CSS variable overrides on :root; same names as the app.css tokens)
const W2_THEMES = [
  { id: 'default', name: 'Default dark', vars: {} },
  { id: 'midnight', name: 'Midnight', vars: { '--bg': '#04060c', '--side': '#070a12', '--panel': '#0a0e19', '--panel2': '#10162a', '--border': '#171f36', '--border2': '#243052' } },
  { id: 'aurora', name: 'Aurora', vars: { '--bg': '#08130f', '--side': '#0b1914', '--panel': '#0f211b', '--panel2': '#152d25', '--border': '#1d3a30', '--border2': '#2a5646', '--acc': '#6ee7b7', '--acc2': '#34d399' } },
  { id: 'light', name: 'Light', scheme: 'light', vars: { '--bg': '#f3f5fa', '--side': '#e9edf5', '--panel': '#ffffff', '--panel2': '#eef1f8', '--border': '#d5dbe8', '--border2': '#b7c1d6', '--text': '#1a2033', '--muted': '#55607a', '--dim': '#8791a8', '--acc': '#2f6fd6', '--acc2': '#2f6fd6', '--ok': '#1a8f55', '--warn': '#a86a00', '--err': '#c4343a' },
    extra: `header { background: #f3f5fad9 !important; }
    .hero { background: radial-gradient(900px 520px at 50% -10%, #d9e5ff, transparent 62%) !important; }
    .hero .aur { opacity: .2 !important; } .hero .stars { display: none; } .hero .ring { border-color: #2f6fd655; }
    .hero .logowrap img { filter: drop-shadow(0 10px 22px #2f6fd655); }
    .grad { background: linear-gradient(120deg, #2f6fd6, #7a4fe0 55%, #12a58a); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .dc-win, .dc-phone { background: #fff !important; border-color: #d5dbe8 !important; box-shadow: 0 30px 70px -28px #1a203366 !important; }
    .dc-bar, .dc-rail { background: #e9edf5 !important; } .dc-side { background: #f3f5fa !important; } .dc-main { background: #fff !important; }
    .dc-rail b { background: #d5dbe8 !important; } .dc-rail b.on { background: linear-gradient(135deg, #5b9dff, #8b6bff) !important; }
    .dc-li.on, .dc-msg.ai p, .dc-pb.them { background: #e9edf5 !important; color: #1a2033 !important; }
    .dc-input, .dc-file { background: #f3f5fa !important; border-color: #d5dbe8 !important; } .dc-tool { background: #2f6fd612 !important; border-color: #2f6fd633 !important; }
    .dc-feat { background: linear-gradient(180deg, #fff, #f6f8fc) !important; }
    section.band.alt { background: linear-gradient(180deg, #e9eef8, #f3f5fa) !important; }
    .dc-notch { background: #c9d1e3 !important; } .dc-phone { border-color: #c9d1e3 !important; }
    .dc-dl { background: radial-gradient(700px 260px at 50% 100%, #2f6fd620, transparent) !important; }
    .plushero svg, .ladder svg { filter: drop-shadow(0 1px 2px #1a203388); }
    .rail { background: #e9edf5 !important; } .msg:hover { background: #0000000a !important; } .pluspill, .status { background: #0000000d !important; } .pill.actyou { color: #fff !important; }` },
  { id: 'contrast', name: 'High contrast', vars: { '--bg': '#000', '--side': '#000', '--panel': '#0a0a0a', '--panel2': '#161616', '--border': '#8c8c8c', '--border2': '#fff', '--text': '#fff', '--muted': '#e6e6e6', '--dim': '#c4c4c4', '--acc': '#ffe14d', '--acc2': '#ffd000' }, extra: 'header { background: #000d !important; }' },
  { id: 'rose', name: 'Rose', vars: { '--bg': '#170d13', '--side': '#1c1118', '--panel': '#24151d', '--panel2': '#2f1c27', '--border': '#44273a', '--border2': '#63384f', '--acc': '#ff8fc0', '--acc2': '#ff5fa5' } },
  { id: 'ocean', name: 'Ocean', vars: { '--bg': '#07141c', '--side': '#0a1a24', '--panel': '#0e2230', '--panel2': '#132c3d', '--border': '#1a3a50', '--border2': '#27577a', '--acc': '#5fd4ff', '--acc2': '#2bb8f0' } },
  { id: 'amber', name: 'Amber', vars: { '--bg': '#160f07', '--side': '#1b130a', '--panel': '#231910', '--panel2': '#2e2114', '--border': '#45321d', '--border2': '#654a2a', '--acc': '#ffc46b', '--acc2': '#ffa93d' } },
  { id: 'violet', name: 'Violet', vars: { '--bg': '#100b1c', '--side': '#140f23', '--panel': '#1b142e', '--panel2': '#241b3b', '--border': '#33264f', '--border2': '#4c3a78', '--acc': '#c4a8ff', '--acc2': '#a17bff' } },
];
const w2Theme = () => W2_THEMES.find(t => t.id === ls.get('auoris_theme')) || W2_THEMES[0];
// Design: 'modern' (glow, starfield, illustrations) or 'legacy' (plain, flat, warm neutral). Saved in this browser.
const w2Design = () => (ls.get('auoris_design') === 'legacy' ? 'legacy' : 'modern');
const LEGACY_PALETTE = ':root { --bg: #262624; --side: #1f1e1d; --panel: #30302e; --panel2: #3a3936; --border: #3d3c39; --border2: #54524d; --text: #f0eee6; --muted: #b0aea5; --dim: #8a887f; --acc: #d97757 !important; --acc2: #c6613f !important; } header { background: #1f1e1dd9 !important; }';
function w2SetDesign(d) { ls.set('auoris_design', d === 'legacy' ? 'legacy' : 'modern'); w2ApplyTheme(); }
function w2ApplyTheme() {
  let st = document.getElementById('themeCss'); if (!st) { st = document.createElement('style'); st.id = 'themeCss'; document.head.appendChild(st); }
  const t = w2Theme(), v = Object.entries(t.vars).map(([k, x]) => `${k}: ${x};`).join(' ');
  const legacy = w2Design() === 'legacy';
  document.body.classList.toggle('legacy', legacy);
  if (legacy && t.id !== 'light' && t.id !== 'contrast') { st.textContent = LEGACY_PALETTE; return; }   // Light and High contrast keep their own colours
  st.textContent = (v || t.scheme ? `:root { ${v}${t.scheme ? ` color-scheme: ${t.scheme};` : ''} }` : '') + (t.extra ? ' ' + t.extra : '');
}
function w2SetTheme(id) { ls.set('auoris_theme', id); w2ApplyTheme(); }
w2ApplyTheme();

// ---- pure helpers (same as ui.html's)
function w2Fuzzy(q, s) {
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
function w2TypingText(n) {
  if (n.length === 1) return n[0] + ' is typing…';
  if (n.length === 2) return n[0] + ' and ' + n[1] + ' are typing…';
  if (n.length === 3) return n[0] + ', ' + n[1] + ' and ' + n[2] + ' are typing…';
  return n[0] + ', ' + n[1] + ' and ' + (n.length - 2) + ' others are typing…';
}

// ================================================================ command palette (Ctrl+K or the ⌘ button in the header)
let w2Home = null;   // last Home list (DMs + groups), cached from loadHomeList so the palette makes no network calls
{ const orig = loadHomeList; loadHomeList = async function () { const r = await orig.apply(this, arguments); w2Home = r; return r; }; }
function w2PalItems() {
  const out = [], add = (group, label, hint, run, kw) => out.push({ group, label, hint: hint || '', run, kw: kw || '' });
  add('Go to', 'Home', 'page', () => go(''));
  add('Go to', 'Local AI', 'page', () => go('localai'));
  add('Go to', 'Plus', 'page', () => go('plus'));
  if (me) {
    [['messages', 'Messages'], ['projects', 'Projects'], ['hosting', 'Hosting'], ['profile', 'Profile'], ['settings', 'Settings'], ['ai', 'AI Providers']].forEach(([p, n]) => add('Go to', n, 'page', () => go(p)));
    if (myProfile && myProfile.is_admin) add('Go to', 'Admin', 'page', () => go('admin'));
    (typeof serverList !== 'undefined' ? serverList : []).forEach(s => add('Server', s.name, 'server', () => go('messages/s/' + s.id), 'servers'));
    acceptedFriends().forEach(p => add('DM', dname(p), '@' + p.username, () => go('messages/dm/' + p.id), 'message friend dm'));
    if (w2Home && w2Home.groups) w2Home.groups.forEach(g => add('Group', g.name, 'group chat', () => go('messages/g/' + g.id), 'groups'));
    add('Action', 'Sign out', '', () => sb.auth.signOut());
  } else { add('Go to', 'Sign in', 'page', () => go('signin')); }
  add('Action', 'Switch design (modern / legacy)', w2Design(), () => w2SetDesign(w2Design() === 'legacy' ? 'modern' : 'legacy'), 'appearance legacy modern simple');
  add('Action', 'Toggle theme (light / dark)', w2Theme().name, () => w2SetTheme(w2Theme().scheme === 'light' ? 'default' : 'light'), 'appearance dark light');
  W2_THEMES.forEach(t => add('Theme', t.name, 'apply theme', () => w2SetTheme(t.id), 'appearance color'));
  return out;
}
const W2P = { items: [], shown: [], sel: 0 };
function w2PalRender() {
  const q = document.getElementById('w2PalIn').value.trim(), list = document.getElementById('w2PalList'), scored = [];
  for (const it of W2P.items) {
    if (!q) { scored.push({ it, score: 0, pos: [] }); continue; }
    let f = w2Fuzzy(q, it.label), pos = f ? f.pos : [];
    if (!f) { const all = w2Fuzzy(q, it.label + ' ' + it.hint + ' ' + it.kw + ' ' + it.group); if (!all) continue; f = { score: all.score - 400, pos: [] }; }
    scored.push({ it, score: f.score, pos });
  }
  if (q) scored.sort((a, b) => b.score - a.score);
  W2P.shown = scored.slice(0, 60); if (W2P.sel >= W2P.shown.length) W2P.sel = Math.max(0, W2P.shown.length - 1);
  list.innerHTML = W2P.shown.length ? W2P.shown.map((s, i) => {
    const set = new Set(s.pos), l = [...s.it.label].map((ch, k) => set.has(k) ? `<mark>${esc(ch)}</mark>` : esc(ch)).join('');
    return `<div class="pi${i === W2P.sel ? ' sel' : ''}" data-i="${i}" role="option"><span class="g">${esc(s.it.group)}</span><span class="l">${l}</span><span class="h">${esc(s.it.hint)}</span></div>`;
  }).join('') : '<div class="none">No matches</div>';
  const el = list.querySelector('.sel'); if (el) el.scrollIntoView({ block: 'nearest' });
}
function w2PalRun(i) {
  const s = W2P.shown[i]; if (!s) return;
  document.getElementById('w2Pal').close();
  setTimeout(() => { try { const r = s.it.run(); if (r && r.catch) r.catch(fail); } catch (e) { fail(e); } }, 0);
}
function w2PalOpen() {
  let d = document.getElementById('w2Pal');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'w2Pal';
    d.innerHTML = `<input id="w2PalIn" placeholder="Type a page, server, chat or person…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true"><div id="w2PalList" role="listbox"></div><div id="w2PalFoot">↑ ↓ to move · Enter to open · Esc to close · Ctrl+K toggles</div>`;
    document.body.appendChild(d);
    const inp = document.getElementById('w2PalIn'), list = document.getElementById('w2PalList');
    inp.addEventListener('input', () => { W2P.sel = 0; w2PalRender(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); W2P.sel = Math.min(W2P.shown.length - 1, W2P.sel + 1); w2PalRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); W2P.sel = Math.max(0, W2P.sel - 1); w2PalRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); w2PalRun(W2P.sel); }
    });
    list.addEventListener('mousemove', e => { const r = e.target.closest('.pi'); if (r && +r.dataset.i !== W2P.sel) { W2P.sel = +r.dataset.i; w2PalRender(); } });
    list.addEventListener('click', e => { const r = e.target.closest('.pi'); if (r) w2PalRun(+r.dataset.i); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }
  W2P.items = w2PalItems(); W2P.sel = 0; document.getElementById('w2PalIn').value = '';
  if (!d.open) d.showModal();
  w2PalRender(); document.getElementById('w2PalIn').focus();
}
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); const d = document.getElementById('w2Pal'); if (d && d.open) d.close(); else w2PalOpen();
  }
}, true);
{ const orig = renderHeader; renderHeader = function () {
  orig.apply(this, arguments);
  const bar = document.querySelector('header .bar'), meEl = document.getElementById('me');
  if (bar && meEl && !document.getElementById('palBtn')) {
    const b = document.createElement('button'); b.id = 'palBtn'; b.type = 'button'; b.className = 'btn sm palbtn'; b.title = 'Search and jump (' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K') + ')'; b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span><kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K') + '</kbd>'; b.onclick = w2PalOpen;
    bar.insertBefore(b, meEl);
  }
}; }

// ================================================================ typing indicators (Realtime broadcast; payload = user id + conversation key only)
// Limitation, honestly: public broadcast channels aren't access-controlled. Only known members' events are ever displayed and blocked/muted users are
// ignored, but someone outside who learns a conversation id could observe who is typing. Private channels + RLS would fix it (needs a schema change).
const TYS = { key: null, ch: null, ready: false, last: 0, sent: false, who: new Map(), members: null };
const tyShare = () => ls.get('auoris_typing_share') !== '0';
function tyKey() {
  if (!me) return null;
  const p = location.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent);
  if (p[0] !== 'messages' || !document.querySelector('#mgPane .composer form')) return null;
  if (p[1] === 'dm' && p[2]) return 'dm:' + [me.id, p[2]].sort().join(':');
  if (p[1] === 'g' && p[2]) return 'gr:' + p[2];
  if (p[1] === 's' && p[2]) { const c = p[3] || (svCache && svCache.chans && svCache.chans[0] && svCache.chans[0].id); return c ? 'ch:' + c : null; }
  return null;
}
function tyIsMember(k, u) {
  if (!k) return false;
  if (k.startsWith('dm:')) return k.split(':').includes(u);
  if (k.startsWith('gr:')) return !!(TYS.members && TYS.members.has(u));
  return !!(svCache && svCache.members && svCache.members.some(m => m.user_id === u));
}
function tyJoin(k) {
  Object.assign(TYS, { key: k, ready: false, sent: false, last: 0, members: null }); TYS.who.clear();
  const ch = sb.channel('typing:' + k, { config: { broadcast: { self: false }, private: true } });
  ch.on('broadcast', { event: 'typing' }, ({ payload }) => tyRecv(k, payload, true));
  ch.on('broadcast', { event: 'typing-stop' }, ({ payload }) => tyRecv(k, payload, false));
  ch.subscribe(st => { if (TYS.ch === ch && st === 'SUBSCRIBED') TYS.ready = true; });
  TYS.ch = ch;
  if (k.startsWith('gr:')) sb.from('group_members').select('user_id').eq('group_id', k.slice(3)).then(({ data }) => { if (TYS.key === k && data) { TYS.members = new Set(data.map(m => m.user_id)); getProfiles(data.map(m => m.user_id)); } });
}
function tyLeave() {
  tyStop();
  if (TYS.ch) { try { sb.removeChannel(TYS.ch); } catch {} }
  TYS.ch = null; TYS.key = null; TYS.ready = false; TYS.members = null; TYS.who.clear();
  const el = document.getElementById('w2Typing'); if (el) { el.textContent = ''; el.classList.remove('on'); }
}
function tyRecv(k, p, on) {
  if (k !== TYS.key || !p || p.c !== k || typeof p.u !== 'string' || p.u === me.id || isHidden(p.u) || !tyIsMember(k, p.u)) return;
  if (on) { TYS.who.set(p.u, Date.now() + 5000); if (!profiles.has(p.u)) getProfiles([p.u]); } else TYS.who.delete(p.u);
  tyRender();
}
function tySend() {
  if (!tyShare() || !TYS.ch || !TYS.ready) return;
  const now = Date.now(); if (now - TYS.last < 3000) return;
  TYS.last = now; TYS.sent = true;
  TYS.ch.send({ type: 'broadcast', event: 'typing', payload: { u: me.id, c: TYS.key } });
}
function tyStop() {
  const was = TYS.sent; TYS.sent = false; TYS.last = 0;
  if (was && TYS.ch && TYS.ready) TYS.ch.send({ type: 'broadcast', event: 'typing-stop', payload: { u: me.id, c: TYS.key } });
}
function tyRender() {
  const now = Date.now();
  for (const [u, t] of TYS.who) if (t < now || isHidden(u) || !tyIsMember(TYS.key, u)) TYS.who.delete(u);
  const el = document.getElementById('w2Typing'); if (!el) return;
  const names = [...TYS.who.keys()].map(u => profiles.has(u) ? dname(profiles.get(u)) : 'Someone');
  el.textContent = names.length ? w2TypingText(names) : ''; el.classList.toggle('on', names.length > 0);
}
function tySync() {
  const k = tyKey();
  if (k !== TYS.key) { tyLeave(); if (k) tyJoin(k); }
  if (TYS.key) {
    const comp = document.querySelector('#mgPane .composer:not([hidden])');
    if (comp) { let el = document.getElementById('w2Typing'); if (!el) { el = document.createElement('div'); el.id = 'w2Typing'; } if (el.nextSibling !== comp) comp.parentNode.insertBefore(el, comp); }
  }
  tyRender();
}
setInterval(() => { try { tySync(); } catch {} }, 700);
document.addEventListener('input', e => {
  const t = e.target; if (!t || t.tagName !== 'INPUT' || t.type !== 'text' || !t.closest('#mgPane .composer form')) return;
  tySync();
  if (t.value.trim()) tySend(); else tyStop();
});
document.addEventListener('submit', e => { if (e.target.closest && e.target.closest('#mgPane .composer')) tyStop(); }, true);

// ================================================================ settings page additions: theme, typing status, sign out everywhere else
{ const orig = PAGES.settings; PAGES.settings = async function () {
  const r = await orig.apply(this, arguments);
  const grid = document.querySelector('#view .grid'), anchor = document.getElementById('stOut');
  if (!grid || !anchor || document.getElementById('w2Appearance')) return r;
  const before = anchor.closest('.card');
  const a = document.createElement('div'); a.className = 'card'; a.id = 'w2Appearance';
  a.innerHTML = `<h3 style="margin-top:0">Appearance</h3><p class="muted">Pick a design and a colour theme. Saved in this browser only. (Custom CSS is a desktop-app feature.)</p>
    <label class="lbl">Design</label>
    <select class="in" id="w2DesignSel" style="margin-bottom:12px"><option value="modern"${w2Design() === 'modern' ? ' selected' : ''}>Modern - glow, starfield and illustrations</option><option value="legacy"${w2Design() === 'legacy' ? ' selected' : ''}>Legacy - plain and simple</option></select>
    <label class="lbl">Colour theme</label>
    <select class="in" id="w2ThemeSel">${W2_THEMES.map(t => `<option value="${esc(t.id)}"${t.id === w2Theme().id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <p class="muted small" style="margin:14px 0 0"><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="w2TypingChk"${tyShare() ? ' checked' : ''}> <span><b>Share typing status</b><br>Let people in a DM, group or channel see when you're typing. Saved in this browser only.</span></label></p>`;
  const s = document.createElement('div'); s.className = 'card'; s.id = 'w2SignOthers';
  s.innerHTML = `<h3 style="margin-top:0">Sign out everywhere else</h3><p class="muted">Ends your sign-in on every other browser and device, and keeps this one signed in. Use it if you lost a device or used a shared computer. (A list of individual devices isn't available.)</p><button class="btn danger" id="w2SoBtn">Sign out other devices…</button>`;
  const qc = document.createElement('div'); qc.className = 'card'; qc.id = 'w2Quota';
  qc.innerHTML = '<h3 style="margin-top:0">Upload storage</h3><p class="muted">Files you send in chats. Sending a file you have already sent does not use any more.</p><div id="w2QuotaRows" class="muted">Loading…</div>';
  grid.insertBefore(a, before); grid.insertBefore(s, before); grid.insertBefore(qc, before);
  attQuota(true).then(q => {
    const box = document.getElementById('w2QuotaRows'); if (!box) return;
    if (!q) { box.textContent = "Couldn't load your usage right now."; return; }
    if (q.unlimited) { box.textContent = 'No upload limits on this account.'; return; }
    const row = (label, k) => { const u = q[k].used, l = q[k].limit, pct = Math.min(100, Math.round(u / l * 100));
      return `<div style="display:grid;grid-template-columns:96px 1fr 120px;gap:10px;align-items:center;margin:8px 0"><span>${label}</span><div style="height:8px;border-radius:99px;background:var(--panel2);overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:${pct >= 90 ? '#ff7b7b' : 'var(--acc)'}"></i></div><b style="text-align:right;color:var(--text)">${attMB(u)} / ${attMB(l)}</b></div>`; };
    box.innerHTML = row('Last 24 hours', 'day') + row('Last 30 days', 'month') + row('In total', 'total');
  });
  document.getElementById('w2ThemeSel').onchange = e => w2SetTheme(e.target.value);
  document.getElementById('w2DesignSel').onchange = e => w2SetDesign(e.target.value);
  document.getElementById('w2TypingChk').onchange = e => { ls.set('auoris_typing_share', e.target.checked ? '1' : '0'); if (!e.target.checked) tyStop(); };
  document.getElementById('w2SoBtn').onclick = async () => {
    if (!confirm('Sign out every other browser and device? This one stays signed in.')) return;
    const { error } = await sb.auth.signOut({ scope: 'others' });
    if (error) return fail(error); toast('All other devices were signed out.');
  };
  return r;
}; }
})();

// ---- Up/Down arrow in a message box walks back through what you sent (like a terminal): Up on an empty box brings
// back your last message, keep pressing for older ones, Down comes forward again and finally back to what you were typing.
(() => {
  const SEL = '.composer form input:not([type=file]):not([type=checkbox]), .composer form textarea';
  const hist = new Map();
  let quiet = false;
  const keyOf = el => (el.id || 'composer') + '@' + location.pathname;
  const st = el => { const k = keyOf(el); let s = hist.get(k); if (!s) hist.set(k, s = { list: [], i: -1, draft: '' }); return s; };
  const note = el => {
    const text = el.value.trim(); if (!text) return;
    setTimeout(() => {  // only counts as sent once the box has been cleared (or the page replaced it)
      if (el.isConnected && el.value.trim()) return;
      const s = st(el); if (s.list[s.list.length - 1] !== text) s.list.push(text);
      if (s.list.length > 100) s.list.shift();
      s.i = -1;
    }, 700);
  };
  const setVal = (el, v) => { quiet = true; el.value = v; el.setSelectionRange(v.length, v.length); el.dispatchEvent(new Event('input', { bubbles: true })); quiet = false; };
  document.addEventListener('input', e => { if (!quiet && e.target.matches && e.target.matches(SEL)) st(e.target).i = -1; });
  document.addEventListener('keydown', e => {
    const el = e.target; if (!el || !el.matches || !el.matches(SEL)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) note(el);
    if (e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const s = st(el), v = el.value, pos = el.selectionStart;
    if (e.key === 'ArrowUp') {
      if (v.slice(0, pos).includes('\n') || !s.list.length || (v !== '' && s.i === -1)) return;
      if (s.i === -1) { s.draft = v; s.i = s.list.length - 1; } else if (s.i > 0) s.i--;
      e.preventDefault(); setVal(el, s.list[s.i]);
    } else {
      if (s.i === -1 || v.slice(pos).includes('\n')) return;
      if (s.i < s.list.length - 1) s.i++; else { s.i = -1; }
      e.preventDefault(); setVal(el, s.i === -1 ? s.draft : s.list[s.i]);
    }
  });
  document.addEventListener('submit', e => { const el = e.target.querySelector && e.target.querySelector(SEL); if (el) note(el); }, true);
})();

(async () => {
  renderHeader();
  try {
    const { data: { session } } = await sb.auth.getSession();
    const first = location.pathname.replace(/^\/+/, '').split('/')[0];
    if (session) await afterSignIn(false, !(first === 'signin' || first === 'signup' || NEEDS_AUTH.has(first)));
  } catch (e) { console.error(e); }
  if (!AUTH.bounced) route();   // afterSignIn already routed to the sign-in step it needs; routing again would reset it to the plain login form
})();
