// auoris.org - one small single-page app with hash routes (#/servers, #/dms/...). Same Supabase accounts as the desktop app.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SUPABASE_URL = 'https://utqswadleapgszwbkvzo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GatsXVrXWFclOrTpAjg3Xw_Jdyra6Hf';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const PCOLS = 'id,username,display_name,color,is_admin,is_mod,plus_since,plus_until,banner_color,banner_url,effect,discord_name,bio';

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

// ---------------------------------------------------------------- badges
const ICON = {
  shield: c => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path fill="#fff" d="m10.6 15.6-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4z"/></svg>`,
  crown: c => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1" fill="${c}"/></svg>`,
  // Plus: a sun with an asteroid swinging past it
  plus: c => `<svg viewBox="0 0 24 24"><g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="12" r="4.2" fill="${c}" stroke="none"/>
    <path d="M10 3.5v2M10 18.5v2M1.5 12h2M16.5 12h2M4 6l1.4 1.4M14.6 16.6 16 18M4 18l1.4-1.4M14.6 7.4 16 6"/></g>
    <path fill="${c}" d="M19.2 3.3c1.3-.3 2.4.6 2.2 1.9-.2 1.1-1.3 1.9-2.4 1.6-1.2-.3-1.6-1.6-1-2.6.3-.5.7-.8 1.2-.9z"/>
    <path d="M17.6 7.2c-.9.9-1.9 1.4-2.8 1.5" stroke="${c}" stroke-width="1" stroke-linecap="round" fill="none" opacity=".7"/></svg>`,
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
function badges(p, serverRole) {
  if (!p) return '';
  const b = [];
  if ((p.username || '').toLowerCase() === 'auoris') b.push(['Owner', ICON.crown('var(--owner)')]);
  else if (p.is_admin) b.push(['Admin', ICON.shield('var(--admin)')]);
  else if (p.is_mod) b.push(['Moderator', ICON.shield('var(--mod)')]);
  if (serverRole === 'owner') b.push(['Server owner', ICON.crown('var(--owner)')]);
  else if (serverRole === 'admin') b.push(['Server admin', ICON.shield('var(--admin)')]);
  else if (serverRole === 'moderator') b.push(['Server moderator', ICON.shield('var(--mod)')]);
  const t = plusTier(p);
  if (t) b.push([`Auoris Plus · ${t.name}${t.months ? ` · ${t.months} mo` : ''}`, ICON.plus(t.color)]);
  const merged = new Map();  // same icon twice (e.g. site Owner + server owner) shows once with both titles
  for (const [title, svg] of b) merged.set(svg, merged.has(svg) ? merged.get(svg) + ' · ' + title : title);
  return merged.size ? `<span class="badges">${[...merged].map(([svg, title]) => `<span class="bdg" title="${esc(title)}">${svg}</span>`).join('')}</span>` : '';
}
const dname = p => p ? (p.display_name || p.username) : 'Unknown';
// Names and avatars stay plain everywhere; badges only appear on the profile card that opens when you click one.
const who = (p, role) => p ? ` data-uid="${esc(p.id)}"${role ? ` data-role="${esc(role)}"` : ''}` : '';
const avatar = (p, cls = '', role) => `<span class="av ${cls}"${who(p, role)} style="--c:${esc((p && p.color) || '#5b9dff')}">${esc([...dname(p)][0].toUpperCase())}</span>`;
const nameHtml = (p, role) => `<span class="name"${who(p, role)}>${esc(dname(p))}</span>`;
const plainAv = (p, cls = '') => avatar(p, cls).replace(/ data-uid="[^"]*"/, '');  // for rows whose click does something else

async function showProfileCard(uid, role) {
  document.querySelector('.pcard')?.remove();
  const [p] = await getProfiles([uid]); if (!p) return;
  const t = plusTier(p), isMe = me && uid === me.id;
  const friend = friends.find(f => f.other === uid);
  const card = document.createElement('div'); card.className = 'pcard';
  const bannerStyle = p.banner_url && isPlus(p) ? `--bc:url('${encodeURI(p.banner_url)}')` : `--bc:${p.banner_color || '#1c2a52'}`;
  card.innerHTML = `<div class="pcard-in"><div class="banner ${p.effect === 'aurora' && isPlus(p) ? 'effect-aurora' : ''}" style="${bannerStyle};height:90px"></div>
    <div class="profhead" style="margin-top:-34px">${avatar(p, 'lg').replace(/ data-uid="[^"]*"/, '')}</div>
    <div style="padding:6px 20px 20px"><h3 style="margin:4px 0 0">${esc(dname(p))}${badges(p, role)}</h3><div class="muted small">@${esc(p.username)}</div>
      ${t ? `<div class="pluspill" style="margin-top:10px">${ICON.plus(t.color).replace('<svg', '<svg width="15" height="15"')} Auoris Plus · ${esc(t.name)}${t.months ? ` · ${t.months} months` : ''}</div>` : ''}
      ${p.bio ? `<p style="margin:12px 0 0">${emojify(esc(p.bio))}</p>` : ''}
      ${p.discord_name ? `<p class="muted small" style="margin:10px 0 0">Discord: ${esc(p.discord_name)}</p>` : ''}
      <div class="row" style="margin-top:14px">${isMe ? '<a class="btn sm" href="/profile">Edit profile</a>'
        : friend && friend.status === 'accepted' ? `<a class="btn sm primary" href="/dms/${esc(uid)}">Message</a>` : me && !friend ? '<button class="btn sm" id="pcAdd">Add friend</button>' : ''}
        </div><div class="row" id="pcExtra" style="margin-top:8px"></div></div></div>`;
  document.body.appendChild(card);
  card.onclick = e => { if (e.target === card) card.remove(); };
  if (card.querySelector('#pcAdd')) card.querySelector('#pcAdd').onclick = async () => {
    const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: uid });
    if (error) return fail(error.code === '23505' ? 'You already have a request with them.' : error);
    toast(`Friend request sent to @${p.username}`); card.remove();
  };
  if (profileCardExtra) profileCardExtra(uid, card.querySelector('#pcExtra'), () => card.remove());
}
let profileCardExtra = null;  // a page (e.g. a server) can add its own buttons, like role management
document.addEventListener('click', e => {
  const el = e.target.closest('[data-uid]');
  if (!el || el.closest('.pcard')) return;
  e.preventDefault(); e.stopPropagation();
  showProfileCard(el.dataset.uid, el.dataset.role || null);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelector('.pcard')?.remove(); });
function renderBody(text) {
  const html = emojify(esc(text));
  const plain = text.replace(EMOJI_RE, (m, k) => EMOJI[k] || m).replace(/\s/g, '');
  const only = plain && /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|️|‍)+$/u.test(plain)
    && [...plain.matchAll(/\p{Extended_Pictographic}|\p{Regional_Indicator}/gu)].length <= 3;
  return only ? `<span class="emoji-only">${html}</span>` : html;
}

// ---------------------------------------------------------------- shared chat pane (channels, DMs, groups, projects)
function chatPane(pane, o) {
  pane.innerHTML = `<div class="head">${o.onBack ? '<button type="button" class="btn sm mob-back" id="paneBack" title="Back to list">← Back</button>' : ''}${o.title}<span class="sp"></span>${o.headExtra || ''}</div><div class="msgs"></div>
    <div class="composer"><form autocomplete="off"><button type="button" class="emo" title="Emoji">😊</button>
    <input maxlength="2000" placeholder="${esc(o.placeholder || 'Message')}"><button class="btn primary sm">Send</button></form></div>`;
  if (o.onBack) pane.querySelector('#paneBack').onclick = o.onBack;
  const box = pane.querySelector('.msgs'), input = pane.querySelector('input'), seen = new Set();
  let last = null;
  const add = async m => {
    if (seen.has(m.id)) return; seen.add(m.id);
    if (m.sender) await getProfiles([m.sender]);
    const p = m.sender ? profiles.get(m.sender) : null;
    const cont = last && last.sender === m.sender && new Date(m.created_at) - new Date(last.created_at) < 5 * 60e3;
    const el = document.createElement('div'); el.className = 'msg' + (cont ? ' cont' : '') + (m.sender ? '' : ' ai');
    const who = m.sender ? nameHtml(p, o.roleOf ? o.roleOf(m.sender) : null) : `<span class="name">AI</span>${m.model ? ` <span class="muted small">${esc(m.model)}</span>` : ''}`;
    el.innerHTML = `${m.sender ? avatar(p, '', o.roleOf ? o.roleOf(m.sender) : null) : '<span class="av">✦</span>'}<div style="min-width:0;flex:1">${cont ? '' : `<div class="meta">${who}<time>${new Date(m.created_at).toLocaleString()}</time></div>`}
      <div class="body">${renderBody(m.body)}</div></div>${o.canDelete && o.canDelete(m) ? '<button class="btn sm del" title="Delete">🗑</button>' : ''}`;
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => { const err = await o.del(m); if (err) fail(err); else el.remove(); };
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
  })().catch(fail);
  const ch = o.subscribe(add);
  if (ch) pageSubs.push(() => sb.removeChannel(ch));
  pane.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const body = input.value.trim(); if (!body) return;
    input.value = '';
    const err = await o.send(body);
    if (err) { fail(err); input.value = body; }
  };
  pane.querySelector('.emo').onclick = e => {
    e.stopPropagation();
    let pk = pane.querySelector('.picker');
    if (pk) return pk.remove();
    pk = document.createElement('div'); pk.className = 'picker';
    pk.innerHTML = Object.entries(EMOJI).map(([k, v]) => `<button type="button" title=":${k}:" data-k="${k}">${v}</button>`).join('');
    pk.onclick = ev => { const k = ev.target.closest('button')?.dataset.k; if (k) { input.value += `:${k}: `; input.focus(); } };
    pane.querySelector('.composer').appendChild(pk);
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }));
  };
  setTimeout(() => input.focus());
}
const subscribeTable = (name, table, filter, onRow) => sb.channel(name + ':' + Math.random().toString(36).slice(2))
  .on('postgres_changes', Object.assign({ event: 'INSERT', schema: 'public', table }, filter ? { filter } : {}), ({ new: m }) => onRow(m)).subscribe();

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
const NEEDS_AUTH = new Set(['servers', 'dms', 'groups', 'profile', 'settings', 'hosting', 'projects']);
function go(path) { history.pushState(null, '', '/' + path); route(); }
async function route() {
  pageSubs.forEach(f => { try { f(); } catch (e) {} }); pageSubs = [];
  const [name = '', ...args] = location.pathname.replace(/^\/?/, '').split('/').map(decodeURIComponent);
  document.querySelectorAll('#topnav a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
  if (NEEDS_AUTH.has(name) && !me) return go('signin');
  const page = PAGES[name] || PAGES[''];
  window.scrollTo(0, 0);
  try { await page(...args); } catch (e) { main().innerHTML = `<div class="wrap page"><div class="card">Something went wrong: ${esc(e.message || e)}</div></div>`; }
}
function renderHeader() {
  const links = me
    ? [['', 'Home'], ['servers', 'Servers'], ['dms', 'DMs'], ['groups', 'Group Chats'], ['projects', 'Projects'], ['hosting', 'Hosting'], ['plus', 'Plus']]
    : [['', 'Home'], ['plus', 'Plus']];
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

PAGES[''] = async () => {
  main().innerHTML = `
  <section class="hero"><img src="logo.png" alt=""><h1>Meet Auoris</h1>
    <p>A desktop AI agent for local Ollama models or your own cloud keys, with servers, DMs, group chats, rich presence and a phone companion.</p>
    <div class="row"><a class="btn primary" href="#dl" id="dlTop">⬇ Download for Windows</a>${me ? '<a class="btn" href="/servers">Open Servers</a>' : '<a class="btn" href="/signup">Create an account</a>'}</div></section>
  <section class="band"><div class="wrap"><h2>What's inside</h2><p class="lead">Your chats, files and models stay on your own PC.</p><div class="grid">
    <div class="card feat"><div class="ic">🧠</div><h3>Local + cloud AI</h3><p>Local Ollama models, or your own Anthropic / OpenAI-style keys.</p></div>
    <div class="card feat"><div class="ic">🛠</div><h3>Real tool access</h3><p>Reads and edits files, runs commands and browses the web when you let it.</p></div>
    <div class="card feat"><div class="ic">💬</div><h3>Servers, DMs & groups</h3><p>Discord-style servers with channels and roles, DMs and group chats, with :emoji:.</p></div>
    <div class="card feat"><div class="ic">🎮</div><h3>Rich presence</h3><p>See what friends are playing - and their Minecraft server or Roblox game - with a link to join.</p></div>
    <div class="card feat"><div class="ic">🤝</div><h3>AI projects</h3><p>Shared AI projects with friends, without ever exposing anyone's API key.</p></div>
    <div class="card feat"><div class="ic">✨</div><h3>Auoris Plus</h3><p>Banners, profile effects, AI Providers, hosting and a gaming boost.</p></div></div></div></section>
  <section class="band" id="mobile"><div class="wrap"><h2>Auoris on your iPhone</h2><p class="lead">No App Store needed - your phone talks straight to your PC over Wi-Fi.</p><ol class="steps">
    <li>On your PC, open the profile menu → <b>Phone app</b> and switch on "Allow phone access".</li>
    <li>Scan the QR code with your iPhone camera. It opens Auoris in Safari, already paired.</li>
    <li>Tap Share → <b>Add to Home Screen</b>. It now opens like an installed app.</li>
    <li>Your phone needs to be on the same Wi-Fi as your PC when you use it.</li></ol></div></section>
  <section class="band" id="dl"><div class="wrap" style="text-align:center"><h2>Download</h2><p class="lead">Windows 10/11. The installer sets up Ollama for you.</p>
    <a class="btn primary" id="dlBtn" href="https://github.com/9cWork/auoris/releases/latest">⬇ Download Auoris-Setup.exe</a><p class="muted small" id="dlVer">Checking latest version…</p></div></section>`;
  $('dlTop').onclick = e => { e.preventDefault(); $('dl').scrollIntoView(); };
  fetch('https://api.github.com/repos/9cWork/auoris/releases/latest').then(r => r.json()).then(d => {
    const a = (d.assets || []).find(x => x.name.toLowerCase() === 'auoris-setup.exe');
    if (a) { $('dlBtn').href = a.browser_download_url; $('dlVer').textContent = `${d.tag_name} · ${(a.size / 1048576).toFixed(1)} MB`; }
    else $('dlVer').textContent = d.tag_name || '';
  }).catch(() => { $('dlVer').textContent = 'See all releases on GitHub.'; });
};

// ---- sign in / sign up
const AUTH = { mode: 'login', email: '', pendingPass: null, resume: null };
PAGES.signin = async () => { if (me) return go('servers'); authPage(AUTH.resume || 'login'); AUTH.resume = null; };
PAGES.signup = async () => { if (me) return go('servers'); authPage('signup'); };
function authPage(mode) {
  main().innerHTML = `<div class="authwrap"><div class="card authcard"><img src="logo.png" alt="" style="width:56px;border-radius:14px">
    <h2 id="authTitle"></h2><p class="sub" id="authSub"></p><form id="authForm" autocomplete="on" novalidate></form><div id="authErr"></div><div id="authLinks"></div></div></div>`;
  authShow(mode);
}
function authShow(mode, sub) {
  AUTH.mode = mode;
  const T = {
    login: ['Welcome back', 'Sign in to Auoris'], signup: ['Create your account', 'You\'ll pick a username after verifying your email'],
    username: ['Pick a username', 'This is how friends find you. It can\'t be changed later.'], verify: ['Check your email', `We sent a 6-digit code to ${AUTH.email}`],
    forgot: ['Reset your password', 'We\'ll email you a 6-digit code'], reset: ['Choose a new password', `Enter the code sent to ${AUTH.email}`],
    mfa: ['Two-factor code', 'Enter the code from your authenticator app'],
  }[mode];
  $('authTitle').textContent = T[0]; $('authSub').textContent = sub || T[1];
  const inp = (id, label, type, extra) => `<label class="lbl" for="${id}">${label}</label><input class="in" id="${id}" name="${id}" type="${type}" ${extra}>`;
  const code = '<input class="in code" id="aCode" name="aCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" required>';
  const email = inp('aEmail', 'Email', 'email', 'autocomplete="email" required');
  $('authForm').innerHTML = {
    login: email + inp('aPass', 'Password', 'password', 'autocomplete="current-password" required') + '<button class="btn primary">Sign in</button>',
    signup: email + inp('aPass', 'Password', 'password', 'autocomplete="new-password" required minlength="8"') + '<button class="btn primary">Create account</button>',
    username: inp('aUser', 'Username', 'text', 'autocomplete="username" required maxlength="20" pattern="[A-Za-z0-9_]{3,20}" title="3-20 letters, numbers or _"') + '<button class="btn primary">Continue</button>',
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
    if (m === 'signout') { await sb.auth.signOut(); return authShow('login'); }
    if (m === 'resend') { const { error } = await sb.auth.resend({ type: 'signup', email: AUTH.email }); return authErr(error ? error.message : 'Sent a new code.', !error); }
    authShow(m);
  });
  if (AUTH.email && $('aEmail')) $('aEmail').value = AUTH.email;
  authErr('');
  $('authForm').onsubmit = authSubmit;
  setTimeout(() => $('authForm').querySelector('input')?.focus());
}
function authErr(msg, ok) { $('authErr').textContent = msg; $('authErr').className = ok ? 'ok' : ''; }
function authValidate(m, v) {
  if ($('aEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('aEmail'))) return 'Enter a valid email address.';
  if ($('aPass') && (m === 'signup' || m === 'reset') && $('aPass').value.length < 8) return 'Your password needs to be at least 8 characters.';
  if ($('aUser') && !/^[A-Za-z0-9_]{3,20}$/.test(v('aUser'))) return 'Usernames are 3-20 letters, numbers or _.';
  if ($('aCode') && v('aCode').length !== 6) return 'Enter the 6-digit code we emailed you.';
  return null;
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
      const { data, error } = await sb.auth.signUp({ email: AUTH.email, password: $('aPass').value });
      if (error) throw error;
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
async function afterSignIn(fromForm) {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { if (!fromForm) { AUTH.resume = 'mfa'; return go('signin'); } return authShow('mfa'); }
  if (AUTH.pendingPass) { const { error } = await sb.auth.updateUser({ password: AUTH.pendingPass }); AUTH.pendingPass = null; if (error) throw error; }
  const { data: { user }, error } = await sb.auth.getUser();
  if (error) throw error;
  const { data: prof, error: profErr } = await sb.from('profiles').select(PCOLS + ',banned').eq('id', user.id).maybeSingle();
  if (profErr) throw profErr;  // a lookup failure isn't "no profile yet" - don't send an existing user to claim_username
  if (!prof) { if (!fromForm) { AUTH.resume = 'username'; return go('signin'); } return authShow('username'); }
  if (prof.banned) { await sb.auth.signOut(); return authShow('login', 'This account has been suspended.'); }
  me = user; myProfile = prof; profiles.set(prof.id, prof);
  renderHeader();
  if (fromForm) go('servers');
}

// ---- servers
const rankRole = r => ({ owner: 3, admin: 2, moderator: 1, member: 0 })[r] ?? -1;
// svCache holds the server list/channels/members for whichever server is currently open, so switching channels
// within the same server (the common case) doesn't re-query all of that again - only a server switch, or an
// edit that changes it (new channel, rename, kick, role change), refetches. Set svCache = null to force a refetch.
let svCache = null; // { sid, serverCache, s, chans, members, roles, mine }
async function svLoad(sid) {
  const { data: mem, error } = await sb.from('server_members').select('server_id, role, servers(id,name,icon,invite_code,owner_id)').eq('user_id', me.id);
  if (error) throw error;
  const serverCache = mem.filter(m => m.servers).map(m => ({ ...m.servers, myRole: m.role }));
  const s = serverCache.find(x => x.id === sid) || null;
  let chans = [], members = [], roles = new Map(), mine = -1;
  if (s) {
    const [{ data: chansData, error: chErr }, { data: membersData, error: mErr }] = await Promise.all([
      sb.from('channels').select('*').eq('server_id', s.id).order('position').order('created_at'),
      sb.from('server_members').select('user_id, role').eq('server_id', s.id)]);
    if (chErr) throw chErr; if (mErr) throw mErr;
    chans = chansData; members = membersData;
    roles = new Map(members.map(m => [m.user_id, m.role]));
    await getProfiles(members.map(m => m.user_id));
    mine = rankRole(s.myRole);
  }
  svCache = { sid, serverCache, s, chans, members, roles, mine };
}
function svRenderShell() {
  const { serverCache, s, sid, chans, members, mine } = svCache;
  main().innerHTML = `<div class="chat3" id="sv"><div class="rail" id="svRail"></div><div class="side2" id="svSide"></div><div class="pane" id="svPane"></div><div class="members" id="svMembers"></div></div>`;
  $('svRail').innerHTML = serverCache.map(x => `<button title="${esc(x.name)}" data-s="${x.id}" class="${x.id === sid ? 'on' : ''}">${esc(x.icon || [...x.name][0].toUpperCase())}</button>`).join('')
    + '<hr><button title="Create a server" id="svNew">＋</button><button title="Join with an invite code" id="svJoin">🔗</button>';
  $('svRail').querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('servers/' + b.dataset.s));
  $('svNew').onclick = async () => {
    const name = prompt('Server name'); if (!name) return;
    const icon = prompt('Icon (an emoji or a couple of letters, optional)') || null;
    const { data, error } = await sb.rpc('create_server', { name: name.trim().slice(0, 40), icon: icon && icon.trim().slice(0, 8) });
    if (error) return fail(error); svCache = null; go('servers/' + data);
  };
  $('svJoin').onclick = async () => {
    const code = prompt('Invite code'); if (!code) return;
    const { data, error } = await sb.rpc('join_server', { code: code.trim() });
    if (error) return fail(error); svCache = null; go('servers/' + data);
  };
  if (!s) {
    $('sv').classList.add('nomembers'); $('svMembers').remove();
    $('svSide').innerHTML = '<div class="head">Servers</div><div class="list"><div class="empty">Pick a server, create one with ＋, or join one with an invite code 🔗.</div></div>';
    $('svPane').innerHTML = `<div class="head">Welcome</div><div class="msgs"><div class="empty">${serverCache.length ? 'Choose a server on the left.' : 'You\'re not in any servers yet.'}</div></div>`;
    if (serverCache.length && !sid) go('servers/' + serverCache[0].id);
    return;
  }
  $('svSide').innerHTML = `<div class="head"><span style="flex:1">${esc(s.name)}</span>${mine >= 2 ? '<button class="btn sm" id="svSettings" title="Server settings">⚙</button>' : ''}</div>
    <div class="list">${chans.map(x => `<button type="button" class="item" data-c="${x.id}"># ${esc(x.name)}</button>`).join('')}
    ${mine >= 2 ? '<button type="button" class="item" id="chNew">＋ Add channel</button>' : ''}</div>
    <div style="padding:10px;border-top:1px solid var(--border)" class="small muted">Invite code: <b style="color:var(--text)">${esc(s.invite_code)}</b>
      <button class="btn sm" id="svCopy">Copy</button>${s.myRole !== 'owner' ? ' <button class="btn sm danger" id="svLeave">Leave</button>' : ''}</div>`;
  $('svSide').querySelectorAll('[data-c]').forEach(el => el.onclick = () => go(`servers/${s.id}/${el.dataset.c}`));
  $('svCopy').onclick = () => { navigator.clipboard.writeText(s.invite_code); toast('Invite code copied'); };
  if ($('svLeave')) $('svLeave').onclick = async () => {
    if (!confirm(`Leave ${s.name}?`)) return;
    const { error } = await sb.from('server_members').delete().eq('server_id', s.id).eq('user_id', me.id);
    if (error) return fail(error); svCache = null; go('servers');
  };
  if ($('chNew')) $('chNew').onclick = async () => {
    const name = (prompt('Channel name (lowercase letters, numbers, dashes)') || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    const { data, error } = await sb.from('channels').insert({ server_id: s.id, name, position: chans.length }).select().single();
    if (error) return fail(error); svCache = null; go(`servers/${s.id}/${data.id}`);
  };
  if ($('svSettings')) $('svSettings').onclick = async () => {
    const act = prompt('Type "rename", "icon", or (owner only) "delete"'); if (!act) return;
    let r;
    if (act === 'rename') { const n = prompt('New name', s.name); if (n) r = await sb.from('servers').update({ name: n.slice(0, 40) }).eq('id', s.id); }
    else if (act === 'icon') { const n = prompt('New icon (emoji or letters)', s.icon || ''); r = await sb.from('servers').update({ icon: (n || '').slice(0, 8) || null }).eq('id', s.id); }
    else if (act === 'delete' && s.myRole === 'owner' && confirm(`Delete ${s.name} for everyone? This can't be undone.`)) { r = await sb.from('servers').delete().eq('id', s.id); if (!r.error) { svCache = null; return go('servers'); } }
    if (r && r.error) fail(r.error); else { svCache = null; route(); }
  };
  const order = ['owner', 'admin', 'moderator', 'member'], label = { owner: 'Owner', admin: 'Admins', moderator: 'Moderators', member: 'Members' };
  $('svMembers').innerHTML = order.map(r => {
    const ms = members.filter(m => m.role === r); if (!ms.length) return '';
    return `<h5>${label[r]} — ${ms.length}</h5>` + ms.map(m => { const p = profiles.get(m.user_id);
      return `<div class="item"${who(p, m.role)}>${plainAv(p, 'sm')}<span class="name" style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(dname(p))}</span></div>`; }).join('');
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
function svRenderChannel(cid) {
  const { chans, roles, mine } = svCache;
  const c = chans.find(x => x.id === cid) || chans[0];
  $('svSide').querySelectorAll('[data-c]').forEach(el => el.classList.toggle('on', !!c && el.dataset.c === c.id));
  $('sv').classList.toggle('mob-pane', !!c);
  if (!c) { $('svPane').innerHTML = '<div class="head">No channels</div><div class="msgs"><div class="empty">This server has no channels yet.</div></div>'; return; }
  chatPane($('svPane'), {
    title: `# ${esc(c.name)}`, placeholder: `Message #${c.name}`, roleOf: uid => roles.get(uid),
    onBack: () => $('sv').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('channel_messages').select('*').eq('channel_id', c.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('ch', 'channel_messages', `channel_id=eq.${c.id}`, add),
    send: async body => (await sb.from('channel_messages').insert({ channel_id: c.id, sender: me.id, body })).error,
    canDelete: m => m.sender === me.id || mine >= 1,
    del: async m => (await sb.from('channel_messages').delete().eq('id', m.id)).error,
  });
}
PAGES.servers = async (sid, cid) => {
  if (!svCache || svCache.sid !== sid) { await svLoad(sid); svRenderShell(); }
  if (!svCache.s) return;
  svRenderChannel(cid);
};

// ---- DMs (+ friends)
PAGES.dms = async uid => {
  await loadFriends();
  main().innerHTML = `<div class="chat2" id="dm"><div class="side2"><div class="head">Direct messages</div>
    <form id="addF" style="padding:10px;display:flex;gap:6px"><input class="in" id="addFName" placeholder="Add friend by username" autocomplete="off"><button class="btn sm">Add</button></form>
    <div class="list" id="fList"></div></div><div class="pane" id="dmPane"></div></div>`;
  const inc = friends.filter(f => f.status === 'pending' && f.incoming), out = friends.filter(f => f.status === 'pending' && !f.incoming);
  const acc = acceptedFriends();
  $('fList').innerHTML =
    (inc.length ? '<div class="small muted" style="margin:6px 8px">Requests</div>' + inc.map(f => { const p = profiles.get(f.other);
      return `<div class="item">${plainAv(p, 'sm')}<span style="flex:1">${esc(dname(p))}</span><button class="btn sm" data-acc="${f.other}">✓</button><button class="btn sm" data-rm="${f.other}">✕</button></div>`; }).join('') : '')
    + '<div class="small muted" style="margin:6px 8px">Friends</div>'
    + (acc.length ? acc.map(p => `<button type="button" class="item ${p.id === uid ? 'on' : ''}" data-u="${p.id}">${plainAv(p, 'sm')}<span style="min-width:0">${esc(dname(p))}</span></button>`).join('') : '<div class="empty">No friends yet.</div>')
    + (out.length ? '<div class="small muted" style="margin:6px 8px">Sent</div>' + out.map(f => { const p = profiles.get(f.other);
      return `<div class="item">${plainAv(p, 'sm')}<span style="flex:1">${esc(dname(p))}</span><button class="btn sm" data-rm="${f.other}">Cancel</button></div>`; }).join('') : '');
  $('fList').querySelectorAll('[data-u]').forEach(el => el.onclick = () => go('dms/' + el.dataset.u));
  $('fList').querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('requester', b.dataset.acc).eq('addressee', me.id);
    if (error) fail(error); route();
  });
  $('fList').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
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
  const p = uid && acc.find(x => x.id === uid);
  $('dm').classList.toggle('mob-pane', !!p);
  if (!p) { $('dmPane').innerHTML = '<div class="head">Direct messages</div><div class="msgs"><div class="empty">Pick a friend to start chatting.</div></div>'; return; }
  chatPane($('dmPane'), {
    title: `${avatar(p, 'sm')} ${nameHtml(p)}`, placeholder: `Message @${p.username}`,
    onBack: () => $('dm').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('messages').select('*').or(`and(sender.eq.${me.id},recipient.eq.${p.id}),and(sender.eq.${p.id},recipient.eq.${me.id})`).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('dm', 'messages', null, m => { if ((m.sender === p.id && m.recipient === me.id) || (m.sender === me.id && m.recipient === p.id)) add(m); }),
    send: async body => (await sb.from('messages').insert({ sender: me.id, recipient: p.id, body })).error,
  });
};

// ---- group chats
PAGES.groups = async gid => {
  await loadFriends();
  const { data: gm, error } = await sb.from('group_members').select('group_id, group_chats(id,name,owner_id)').eq('user_id', me.id);
  if (error) throw error;
  const groups = gm.filter(x => x.group_chats).map(x => x.group_chats);
  main().innerHTML = `<div class="chat2" id="gr"><div class="side2"><div class="head"><span style="flex:1">Group chats</span><button class="btn sm" id="gNew">＋ New</button></div>
    <div class="list">${groups.length ? groups.map(g => `<button type="button" class="item ${g.id === gid ? 'on' : ''}" data-g="${g.id}">👥 ${esc(g.name)}</button>`).join('') : '<div class="empty">No group chats yet.</div>'}</div></div>
    <div class="pane" id="gPane"></div></div>`;
  main().querySelectorAll('[data-g]').forEach(el => el.onclick = () => go('groups/' + el.dataset.g));
  $('gNew').onclick = () => {
    const acc = acceptedFriends();
    $('gPane').innerHTML = `<div class="head">New group chat</div><div style="padding:18px;max-width:460px"><label class="lbl">Name</label><input class="in" id="gName" maxlength="40" placeholder="The squad">
      <label class="lbl">Friends to add (up to 9)</label>${acc.length ? acc.map(p => `<label class="item"><input type="checkbox" value="${p.id}"> ${plainAv(p, 'sm')} ${esc(dname(p))}</label>`).join('') : '<div class="empty">Add some friends first.</div>'}
      <button class="btn primary" id="gCreate" style="margin-top:14px">Create group</button></div>`;
    $('gCreate').onclick = async () => {
      const members = [...$('gPane').querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
      const name = $('gName').value.trim() || 'Group chat';
      const { data, error } = await sb.rpc('create_group', { name, members });
      if (error) return fail(error); go('groups/' + data);
    };
  };
  const g = groups.find(x => x.id === gid);
  $('gr').classList.toggle('mob-pane', !!g);
  if (!g) { $('gPane').innerHTML = '<div class="head">Group chats</div><div class="msgs"><div class="empty">Pick a group or make a new one with friends.</div></div>'; return; }
  const { data: mems } = await sb.from('group_members').select('user_id').eq('group_id', g.id);
  const ps = await getProfiles(mems.map(m => m.user_id));
  chatPane($('gPane'), {
    title: `👥 ${esc(g.name)} <span class="muted small" style="font-weight:400">· ${ps.filter(Boolean).map(p => esc(dname(p))).join(', ')}</span>`,
    headExtra: `<button class="btn sm" id="gAdd">Add friend</button><button class="btn sm danger" id="gLeave">Leave</button>`, placeholder: `Message ${g.name}`,
    onBack: () => $('gr').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('group_messages').select('*').eq('group_id', g.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('gm', 'group_messages', `group_id=eq.${g.id}`, add),
    send: async body => (await sb.from('group_messages').insert({ group_id: g.id, sender: me.id, body })).error,
  });
  $('gAdd').onclick = async () => {
    const inIt = new Set(mems.map(m => m.user_id)), cand = acceptedFriends().filter(p => !inIt.has(p.id));
    if (!cand.length) return toast('All your friends are already here.');
    const name = prompt('Add which friend? ' + cand.map(p => '@' + p.username).join(', ')); if (!name) return;
    const p = cand.find(x => x.username.toLowerCase() === name.replace(/^@/, '').toLowerCase()); if (!p) return toast('Not one of your friends here.');
    const { error } = await sb.rpc('add_group_member', { gid: g.id, target: p.id }); if (error) return fail(error); route();
  };
  $('gLeave').onclick = async () => {
    if (!confirm(`Leave ${g.name}?`)) return;
    const { error } = await sb.from('group_members').delete().eq('group_id', g.id).eq('user_id', me.id);
    if (error) return fail(error); go('groups');
  };
};

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
        ${t ? `<span class="pluspill">${ICON.plus(t.color).replace('<svg', '<svg width="16" height="16"')} Auoris Plus · ${esc(t.name)}${t.months ? ` · ${t.months} months` : ''}</span>` : '<a class="pluspill" href="/plus" style="text-decoration:none;color:var(--muted)">Get Auoris Plus for banners & effects →</a>'}
        <label class="lbl">Display name</label><input class="in" id="pfName" maxlength="40" value="${esc(p.display_name || '')}">
        <label class="lbl">Bio</label><textarea class="in" id="pfBio" maxlength="200" rows="2">${esc(p.bio || '')}</textarea>
        <label class="lbl">Avatar colour</label><div class="swatches" id="pfColor">${COLORS.map(c => `<i style="background:${c}" data-c="${c}" class="${c === p.color ? 'on' : ''}"></i>`).join('')}</div>
        <label class="lbl">Banner colour</label><div class="swatches" id="pfBanner">${BANNERS.map(c => `<i style="background:${c}" data-c="${c}" class="${c === p.banner_color ? 'on' : ''}"></i>`).join('')}</div>
        <div class="${plus ? '' : 'locked'}"><label class="lbl">Banner image URL ${plus ? '' : '(Plus)'}</label><input class="in" id="pfBannerUrl" placeholder="https://…/banner.png" value="${esc(p.banner_url || '')}">
          <label class="lbl">Profile effect ${plus ? '' : '(Plus)'}</label><select class="in" id="pfEffect">${['none', 'aurora', 'sparkle', 'flame', 'glitch'].map(e => `<option ${e === (p.effect || 'none') ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="pfSave">Save profile</button></div>
      </div></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">Connections</h3><p class="muted small">Link your Discord account. It shows on your profile and appears under Connections on Discord.</p>
      <div class="row">${p.discord_name ? `<span>Connected as <b>${esc(p.discord_name)}</b></span>` : ''}<button class="btn" id="pfDiscord">${p.discord_name ? 'Reconnect Discord' : 'Connect Discord'}</button></div></div></div>`;
  const pick = (id, key) => $(id).querySelectorAll('i').forEach(i => i.onclick = () => { $(id).querySelectorAll('i').forEach(x => x.classList.remove('on')); i.classList.add('on'); pick[key] = i.dataset.c; });
  pick('pfColor', 'color'); pick('pfBanner', 'banner_color');
  $('pfSave').onclick = async () => {
    const patch = { display_name: $('pfName').value.trim() || null, bio: $('pfBio').value.trim() || null };
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
  $('pfDiscord').onclick = async () => {
    const { data, error } = await sb.functions.invoke('discord-connect', { body: { action: 'start', redirect: location.origin + location.pathname } });
    if (error || !data || !data.url) return toast('Discord connections aren\'t switched on yet - check back soon.');
    location.href = data.url;
  };
};

// ---- settings
PAGES.settings = async () => {
  main().innerHTML = `<div class="wrap page"><h1>Settings</h1><p class="lead">Account and security. App-only settings (rich presence, AI models, proxy) live in the Auoris app.</p>
    <div class="grid" style="grid-template-columns:1fr">
    <div class="card"><h3 style="margin-top:0">Account</h3><p class="muted">${esc(me.email || '')}</p>
      <label class="lbl">New password</label><div class="row"><input class="in" id="stPass" type="password" autocomplete="new-password" placeholder="8+ characters" style="flex:1"><button class="btn" id="stPassBtn">Change</button></div></div>
    <div class="card" id="stMfa"><h3 style="margin-top:0">Two-factor authentication</h3><p class="muted">Loading…</p></div>
    <div class="card"><h3 style="margin-top:0">Sign out</h3><button class="btn danger" id="stOut">Sign out of this browser</button></div></div></div>`;
  $('stPassBtn').onclick = async () => {
    const { error } = await sb.auth.updateUser({ password: $('stPass').value });
    if (error) return fail(error); $('stPass').value = ''; toast('Password changed');
  };
  $('stOut').onclick = () => sb.auth.signOut();
  renderMfa();
};
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

// ---- plus
PAGES.plus = async () => {
  const p = myProfile, t = plusTier(p);
  const perks = [['🖼', 'Custom banners & profile images', 'Free accounts keep banner colours.'], ['✨', 'Profile effects', 'Aurora, sparkle, flame and more.'],
    ['🌐', 'Browser proxy', 'Route the built-in browser through a proxy.'], ['🧠', 'AI Providers', 'Use Claude, GPT, Gemini and more with your own keys.'],
    ['🎮', 'Gaming boost', 'FPS, ping and background-load tuning in the app.'], ['🖥', 'Hosting', 'Up to 3 game servers on servers.auoris.org.']];
  main().innerHTML = `<div class="wrap page"><div class="plushero">${ICON.plus('#ffffff')}<h1 style="margin-top:14px">Auoris Plus</h1>
    <div class="price">$19.99<small> / month</small></div><p class="muted">Cancel anytime.</p>
    <div class="row" style="justify-content:center;margin-top:18px">${t ? `<span class="pluspill">You have Plus · ${esc(t.name)}${t.months ? ` · ${t.months} months` : ''}</span><button class="btn" id="plusManage">Manage subscription</button>`
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
  const owner = x.myRole === 'owner';
  chatPane($('pPane'), {
    title: `🤝 ${esc(x.name)} <span class="muted small" style="font-weight:400">· ${esc(x.provider || '')}${x.model ? ' / ' + esc(x.model) : ''} · ${mems.length} member${mems.length === 1 ? '' : 's'}</span>`,
    headExtra: `<button class="btn sm" id="pInfo">Project</button>`, placeholder: `Message ${x.name}`, emptyText: 'Start the conversation - everyone in the project sees it.',
    onBack: () => $('pr').classList.remove('mob-pane'),
    load: async () => { const { data, error } = await sb.from('ai_project_messages').select('*').eq('project_id', x.id).order('created_at', { ascending: false }).limit(150); if (error) throw error; return data.reverse(); },
    subscribe: add => subscribeTable('pm', 'ai_project_messages', `project_id=eq.${x.id}`, add),
    send: async body => {
      const err = (await sb.from('ai_project_messages').insert({ project_id: x.id, sender: me.id, body })).error;
      if (!err && x.key_mode === 'creator_key') sb.functions.invoke('ai-project-reply', { body: { project_id: x.id } }).then(({ error }) => { if (error) toast('The AI couldn\'t reply yet - project replies are switching on soon.'); });
      return err;
    },
  });
  $('pInfo').onclick = () => {
    $('pPane').innerHTML = `<div class="head">🤝 ${esc(x.name)}<span class="sp"></span><button class="btn sm" id="pBack">Back to chat</button></div><div style="padding:18px;max-width:620px;overflow-y:auto">
      <p class="muted">${esc(x.description || '')}</p>
      <p><b>API keys:</b> ${esc(KEY_MODES[x.key_mode])}</p>
      ${x.key_mode === 'creator_key' ? (owner ? `<div class="card"><b>Your API key</b> <span class="muted small">${x.has_creator_key ? '· saved - it can\'t be viewed, only replaced or removed' : '· not set yet'}</span>
          <div class="row" style="margin-top:10px"><input class="in" id="pKey" type="password" autocomplete="off" placeholder="Paste a new key" style="flex:1"><button class="btn primary" id="pKeySave">Save key</button>${x.has_creator_key ? '<button class="btn danger" id="pKeyDel">Remove</button>' : ''}</div>
          <p class="muted small">Stored encrypted on the server and only used to answer this project. No one - including you - can read it back.</p></div>`
        : `<p class="muted">${x.has_creator_key ? 'The creator\'s key is set - AI replies here use it. You never see it.' : 'Waiting for the creator to add a key.'}</p>`) : ''}
      ${x.key_mode !== 'creator_key' ? '<p class="muted small">AI replies are made from each member\'s Auoris app - open this project in the app to reply with your model.</p>' : ''}
      <h3>Members</h3>${mems.map(m => { const p = profiles.get(m.user_id); return `<div class="item">${avatar(p, 'sm')} ${nameHtml(p)} <span class="muted small">${m.role}</span></div>`; }).join('')}
      ${['owner', 'editor'].includes(x.myRole) ? `<div class="row" style="margin-top:10px"><select class="in" id="pAddSel" style="max-width:260px">${acceptedFriends().filter(p => !mems.some(m => m.user_id === p.id)).map(p => `<option value="${p.id}">@${esc(p.username)}</option>`).join('')}</select><button class="btn" id="pAdd">Add friend</button></div>` : ''}
      <div class="row" style="margin-top:22px">${owner ? '<button class="btn danger" id="pDel">Delete project</button>' : '<button class="btn danger" id="pLeave">Leave project</button>'}</div></div>`;
    $('pBack').onclick = () => route();
    if ($('pKeySave')) $('pKeySave').onclick = async () => {
      const key = $('pKey').value.trim(); $('pKey').value = '';
      const { error } = await sb.rpc('set_project_key', { pid: x.id, api_key: key }); if (error) return fail(error); toast('Key saved - it can\'t be viewed again'); route();
    };
    if ($('pKeyDel')) $('pKeyDel').onclick = async () => { const { error } = await sb.rpc('clear_project_key', { pid: x.id }); if (error) return fail(error); route(); };
    if ($('pAdd')) $('pAdd').onclick = async () => { const t = $('pAddSel').value; if (!t) return; const { error } = await sb.rpc('add_project_member', { pid: x.id, target: t }); if (error) return fail(error); route(); };
    if ($('pDel')) $('pDel').onclick = async () => { if (!confirm('Delete this project for everyone?')) return; const { error } = await sb.from('ai_projects').delete().eq('id', x.id); if (error) return fail(error); go('projects'); };
    if ($('pLeave')) $('pLeave').onclick = async () => { const { error } = await sb.from('ai_project_members').delete().eq('project_id', x.id).eq('user_id', me.id); if (error) return fail(error); go('projects'); };
  };
};

// ---------------------------------------------------------------- boot
sb.auth.onAuthStateChange(ev => {
  if (ev !== 'SIGNED_OUT') return;
  me = myProfile = null; renderHeader(); go('');
});
window.addEventListener('popstate', route);
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
(async () => {
  renderHeader();
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await afterSignIn(false);
  } catch (e) { console.error(e); }
  route();
})();
