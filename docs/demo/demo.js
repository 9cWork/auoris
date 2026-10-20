// The website demo (auoris.org/demo/): app.html is the app's own page (ui.html, copied by tools/publish_site.py) with this file in place
// of the Python side (app.py's Api, reached as window.pywebview.api) and of the Auoris servers (the Supabase client). Everything here
// is made up and lives in memory: nothing is sent anywhere, nothing is saved, and anything that would do something real only says so.
(() => {
const VERSION = document.currentScript.dataset.version || '';
const MIND = location.search === '?mind';   // app.html?mind is Auoris Mind (the demo page's switch)
const DEMO_MSG = 'This is a demo. Download Auoris to do this for real.';
const STEVE = 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';   // Mojang's Steve, as the app loads it
const NOW = Date.now(), ago = mins => new Date(Date.now() - mins * 60000).toISOString();
const later = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
const never = () => new Promise(() => {});   // an action the demo can't do: the toast said so, nothing else happens
function demoToast() { toast('This is a demo', 'Download Auoris to do this for real. Click here to get it.', () => { window.top.location.href = '/#dl'; }); }   // ui.html's toast()
const getJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
const dataUrl = url => fetch(url).then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); }));
const catalog = getJson('cosmetics.json');
// the pictures as data URLs, like app.py mc_cosmetics_data sends them: the Cosmetics tab draws its thumbnails right away
const cosmetics = catalog.then(async d => ({ catalog: d.catalog, png: Object.fromEntries(await Promise.all(Object.entries(d.png).map(async ([k, u]) => [k, await dataUrl(u)]))) }));
const legal = getJson('/legal/legal.json').then(async L => {   // the site's copy of legal/ (app.py legal_get)
  L.docs = await Promise.all(L.docs.map(async d => ({ id: d.id, title: d.title, text: await fetch('/legal/' + d.file).then(r => r.text()) })));
  return L;
});
const steve = dataUrl(STEVE).catch(() => null);

// ---------------------------------------------------------------- made-up people
const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ME = ID(1);
const person = (n, username, display_name, color, extra) => ({ id: ID(n), username, display_name, color, avatar_url: null, is_admin: false, is_mod: false,
  is_developer: false, is_tester: false, is_creator: false, is_host: false, plus_until: null, plus_since: null, created_at: ago(60 * 24 * 90 * n), bio: '', ...extra });
const MY_PROFILE = person(1, 'demo_player', 'Demo Player', '#5b9dff', { bio: 'Trying out Auoris', banned: false, dm_policy: 'everyone', friend_request_policy: 'everyone',
  group_invite_policy: 'friends', legal_version: null, legal_accepted_at: ago(5), kills: 0 });
const FRIENDS = [person(2, 'pixelfox', 'PixelFox', '#ff8fc0', { is_creator: true }), person(3, 'nova', 'Nova', '#7fb4ff', { plus_until: ago(-60 * 24 * 20), plus_since: ago(60 * 24 * 200) }),
  person(4, 'craftykai', 'CraftyKai', '#6ee7b7'), person(5, 'sunny', 'Sunny', '#ffc46b')];
const ASKER = person(6, 'blockbuilder', 'BlockBuilder', '#c4a1ff');   // a friend request waiting for you
const PEOPLE = [MY_PROFILE, ...FRIENDS, ASKER];
const prof = id => PEOPLE.find(p => p.id === id);
const PRESENCE = [   // who is online (rpc presence_friends); Sunny is offline
  { user_id: ID(2), online: true, status: 'online', status_text: null, party: null, game: { name: 'Minecraft', server: 'smp.example.net' } },
  { user_id: ID(3), online: true, status: 'online', status_text: 'building a castle', party: null, game: null },
  { user_id: ID(4), online: true, status: 'idle', status_text: null, party: null, game: null }];

// ---------------------------------------------------------------- the made-up database (Supabase tables, already joined the way the page asks)
const GROUP = { id: ID(101), name: 'Build team', owner_id: ID(2), created_at: ago(60 * 24 * 30) };
const SERVER = { id: ID(201), name: 'Block Party', icon: '🧱', invite_code: 'demo', owner_id: ID(2), is_public: true, description: 'A made-up community server for the demo.',
  category: 'gaming', banner_path: null, created_at: ago(60 * 24 * 60) };
let seq = 1000;
const msg = (extra, mins) => ({ id: ID(++seq), created_at: ago(mins), body: '', attachments: null, reply_to: null, edited_at: null, ...extra });
const DB = {
  profiles: PEOPLE,
  friendships: [...FRIENDS.map(f => ({ requester: f.id, addressee: ME, status: 'accepted', r: f, a: MY_PROFILE })),
    { requester: ASKER.id, addressee: ME, status: 'pending', r: ASKER, a: MY_PROFILE }],
  messages: [
    msg({ sender: ID(2), recipient: ME, body: 'are you on the SMP tonight?' }, 95),
    msg({ sender: ME, recipient: ID(2), body: 'yes, after dinner' }, 90),
    msg({ sender: ID(2), recipient: ME, body: 'nice, I\'ll wait at spawn 🏰' }, 88),
    msg({ sender: ID(3), recipient: ME, body: 'that new cape looks great on you' }, 60 * 26)],
  group_chats: [GROUP],
  group_members: [ME, ID(2), ID(3), ID(4)].map(u => ({ group_id: GROUP.id, user_id: u, group_chats: GROUP, profiles: prof(u) })),
  group_messages: [
    msg({ group_id: GROUP.id, sender: ID(4), body: 'who has diamonds for the beacon?' }, 300),
    msg({ group_id: GROUP.id, sender: ID(3), body: 'I have 9, bringing them tonight' }, 290),
    msg({ group_id: GROUP.id, sender: ID(2), body: 'legend' }, 288)],
  servers: [SERVER],
  server_members: [[ID(2), 'owner'], [ME, 'member'], [ID(3), 'admin'], [ID(4), 'member']].map(([u, role]) => ({ server_id: SERVER.id, user_id: u, role, servers: SERVER, profiles: prof(u) })),
  channels: [{ id: ID(301), server_id: SERVER.id, name: 'general', position: 0, created_at: ago(60 * 24 * 60) }, { id: ID(302), server_id: SERVER.id, name: 'builds', position: 1, created_at: ago(60 * 24 * 60) }],
  channel_messages: [
    msg({ channel_id: ID(301), sender: ID(2), body: 'Welcome to Block Party! Say hi 👋' }, 60 * 24 * 3),
    msg({ channel_id: ID(301), sender: ID(4), body: 'hi everyone' }, 60 * 24 * 2),
    msg({ channel_id: ID(302), sender: ID(3), body: 'finished the castle walls today' }, 60 * 5)],
  cosmetics_owned: [{ kind: 'hat', item: 'wizard' }, { kind: 'pet', item: 'fox' }],
};
const CHAT_TABLES = new Set(['messages', 'group_messages', 'channel_messages']);   // sending works (in memory); every other write says it's a demo
const QUIET_WRITES = new Set(['presence_status', 'mc_presence']);                    // the app's own background writes: accepted and dropped

// PostgREST filters, as far as the page uses them: eq/neq/gt/gte/lt/lte/in/is/ilike and or(...) with and(...) inside
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const c of s) { if (c === ',' && !depth) { out.push(cur); cur = ''; continue; } if (c === '(') depth++; if (c === ')') depth--; cur += c; }
  return cur ? out.concat(cur) : out;
}
function cmp(v, op, x) {
  if (v === undefined) return true;   // a column the made-up row doesn't have: don't let it hide the row
  if (op === 'eq') return String(v) === String(x);
  if (op === 'neq') return String(v) !== String(x);
  if (op === 'gt') return v > x; if (op === 'gte') return v >= x; if (op === 'lt') return v < x; if (op === 'lte') return v <= x;
  if (op === 'in') return (Array.isArray(x) ? x : String(x).replace(/^\(|\)$/g, '').split(',')).map(String).includes(String(v));
  if (op === 'is') return x === null || x === 'null' ? v == null : String(v) === String(x);
  if (op === 'ilike' || op === 'like') return new RegExp('^' + String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(v));
  return true;
}
function term(row, t) {
  const m = /^(and|or)\((.*)\)$/.exec(t);
  if (m) return m[1] === 'and' ? splitTop(m[2]).every(x => term(row, x)) : splitTop(m[2]).some(x => term(row, x));
  const [col, op, ...rest] = t.split('.');
  return cmp(row[col], op, rest.join('.'));
}
const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike']);
const matches = (row, filters) => filters.every(([op, col, x]) => op === 'or' ? splitTop(col).some(t => term(row, t)) : cmp(row[col], op, x));

// sb.from(table) / sb.rpc(name): a chainable query that runs when awaited
function query(table, rpc, args) {
  const q = { table, rpc, args, op: 'select', filters: [], order: [], limit: null, one: null, values: null };
  const b = new Proxy({}, { get(_, k) {
    if (typeof k !== 'string') return undefined;
    if (k === 'then') return (ok, bad) => run(q).then(ok, bad);
    if (k === 'catch' || k === 'finally') return f => run(q)[k](f);
    return (...a) => {
      if (FILTERS.has(k)) q.filters.push([k, a[0], a[1]]);
      else if (k === 'or') q.filters.push(['or', a[0]]);
      else if (k === 'match') Object.entries(a[0] || {}).forEach(([c, v]) => q.filters.push(['eq', c, v]));
      else if (k === 'order') q.order.push([a[0], !(a[1] && a[1].ascending === false)]);
      else if (k === 'limit') q.limit = a[0];
      else if (k === 'range') q.limit = a[1] - a[0] + 1;
      else if (k === 'single' || k === 'maybeSingle') q.one = k;
      else if (['insert', 'update', 'upsert', 'delete'].includes(k)) { q.op = k; q.values = a[0]; }
      return b;   // select(), returns(), abortSignal() and the rest don't change the made-up answer
    };
  } });
  return b;
}
const RPC = {
  my_profile: async () => { MY_PROFILE.legal_version = (await legal).version; return [MY_PROFILE]; },   // already accepted
  presence_friends: async () => {
    setTimeout(() => { try { mcFriendsRender(); mcNotifRender(); } catch (e) {} }, 300);   // the Play tab would only show them at its next 15 s refresh
    return PRESENCE.map(p => ({ ...p, age_secs: 5 }));
  },
  touch_ip: async () => null,
};
async function run(q) {
  await later(60);   // answers arrive a moment later, like from a server
  let rows;
  if (q.rpc) {
    if (!RPC[q.rpc]) return { data: null, error: { message: DEMO_MSG, code: 'DEMO' } };
    rows = await RPC[q.rpc](q.args);
    if (!Array.isArray(rows)) return { data: rows, error: null };
  } else if (q.op !== 'select') return write(q);
  else rows = DB[q.table] || [];
  rows = rows.filter(r => matches(r, q.filters));
  for (const [col, asc] of q.order.slice().reverse()) rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
  if (q.limit != null) rows = rows.slice(0, q.limit);
  rows = rows.map(r => ({ ...r }));
  if (!q.one) return { data: rows, error: null, count: rows.length };
  if (!rows.length && q.one === 'single') return { data: null, error: { message: 'No rows', code: 'PGRST116' } };
  return { data: rows[0] || null, error: null };
}
function write(q) {
  if (QUIET_WRITES.has(q.table)) return { data: null, error: null };
  if (!CHAT_TABLES.has(q.table) || q.op === 'upsert') return { data: null, error: { message: DEMO_MSG } };
  const rows = DB[q.table];
  if (q.op === 'insert') {
    const row = msg({ ...q.values, sender: ME }, 0);
    rows.push(row); emit(q.table, 'INSERT', row);
    if (row.body) autoReply(q.table, row);
    return { data: q.one ? row : [row], error: null };
  }
  const hit = rows.filter(r => matches(r, q.filters));
  for (const r of hit) {
    if (q.op === 'update') { Object.assign(r, q.values); emit(q.table, 'UPDATE', r); }
    else { rows.splice(rows.indexOf(r), 1); emit(q.table, 'DELETE', null, r); }
  }
  return { data: null, error: null };
}
// a friend answers what you send, so the chat feels alive
const REPLIES = ['haha nice', 'sounds good!', 'see you on the server 👋', 'wait, are you on the Auoris demo? download it, it\'s better in the app'];
function autoReply(table, m) {
  const from = table === 'messages' ? m.recipient : [ID(2), ID(3), ID(4)][seq % 3];
  if (!prof(from) || from === ASKER.id) return;
  setTimeout(() => {
    const row = msg({ sender: from, body: REPLIES[seq % REPLIES.length], ...(table === 'messages' ? { recipient: ME } : table === 'group_messages' ? { group_id: m.group_id } : { channel_id: m.channel_id }) }, 0);
    DB[table].push(row); emit(table, 'INSERT', row);
  }, 1800);
}

// realtime: postgres_changes for the made-up tables; nothing else ever arrives
const CHANNELS = new Set();
function channel() {
  const ch = {
    handlers: [],
    on(type, filter, cb) { if (typeof filter === 'function') { cb = filter; filter = {}; } ch.handlers.push({ type, filter: filter || {}, cb }); return ch; },
    subscribe(cb) { CHANNELS.add(ch); if (cb) setTimeout(() => cb('SUBSCRIBED'), 50); return ch; },
    send: async () => 'ok', track: async () => 'ok', untrack: async () => 'ok', presenceState: () => ({}),
    unsubscribe: async () => { CHANNELS.delete(ch); return 'ok'; },
  };
  return ch;
}
function emit(table, event, row, old) {
  for (const ch of CHANNELS) for (const h of ch.handlers) {
    const f = h.filter, m = /^(\w+)=eq\.(.+)$/.exec(f.filter || '');
    if (h.type !== 'postgres_changes' || f.table !== table || (f.event !== '*' && f.event !== event)) continue;
    if (m && row && String(row[m[1]]) !== m[2]) continue;
    try { h.cb({ eventType: event, schema: 'public', table, new: row || {}, old: old || {} }); } catch (e) { console.error(e); }
  }
}
setInterval(() => PRESENCE.forEach(p => emit('presence_status', 'UPDATE', { ...p })), 30000);   // keeps the made-up friends online

const USER = { id: ME, email: 'demo@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: MY_PROFILE.created_at };
const fakeSb = {
  from: t => query(t),
  rpc: (name, args) => query(null, name, args),
  channel,
  removeChannel: async ch => { if (ch) CHANNELS.delete(ch); return 'ok'; },
  removeAllChannels: async () => { CHANNELS.clear(); return []; },
  getChannels: () => [...CHANNELS],
  auth: new Proxy({
    storageKey: 'sb-demo-auth-token',
    getSession: async () => ({ data: { session: { user: USER, access_token: 'demo', expires_at: NOW / 1000 + 3600 } }, error: null }),
    getUser: async () => ({ data: { user: USER }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => { demoToast(); return { error: null }; },
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
      listFactors: async () => ({ data: { all: [], totp: [] }, error: null }) },
    getUserIdentities: async () => ({ data: { identities: [] }, error: null }),
  }, { get: (o, k) => k in o ? o[k] : async () => ({ data: {}, error: { message: DEMO_MSG } }) }),
  storage: { from: () => ({
    upload: async () => ({ data: null, error: { message: DEMO_MSG } }), remove: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }),
    createSignedUrl: async () => ({ data: null, error: { message: DEMO_MSG } }), createSignedUrls: async () => ({ data: [], error: null }),
    getPublicUrl: () => ({ data: { publicUrl: '' } }), download: async () => ({ data: null, error: { message: DEMO_MSG } }) }) },
  functions: { invoke: async () => { demoToast(); return never(); } },   // payments, gifts, badges, account changes
};
window.supabase = { createClient: () => fakeSb };

// ---------------------------------------------------------------- the Python side (app.py Api)
const SERVERS = [
  { name: 'School SMP', ip: 'smp.example.net', icon: '', last: NOW / 1000 - 3600 },
  { name: 'Creative', ip: 'creative.example.org', icon: '', last: NOW / 1000 - 86400 },
  { name: 'My SMP', ip: '192.168.1.20', icon: '', last: NOW / 1000 - 3 * 86400 },
  { name: 'My World', ip: 'localhost:25570', icon: '', last: 0 }];
const STATUS = { 'smp.example.net': { online: 14, max: 50, ms: 38 }, 'creative.example.org': { online: 212, max: 500, ms: 96 }, '192.168.1.20': { online: 2, max: 10, ms: 4 } };   // any other server is offline
const MODS = { '1.8.9': [{ name: 'worldedit-forge-mc1.8.9-6.1.1.jar', size: 1468006, on: true }, { name: 'journeymap-1.8.9-5.1.4.jar', size: 2936012, on: false }] };
const PREFS = { mc_mem_gb: 4, mc_last_version: '1.8.9', mc_mods_on: true, mc_hide_loading: true, mc_hero_bg: 'sunset-lake',
  mc_cosmetics: { cape: 'starlight', wings: 'none', hat: 'wizard', pet: 'fox' }, theme_id: 'default', ui_design: 'modern', tour_done: true, profile_name: 'Demo Player' };
let access = { staff: false, plus: false, owned: [] };
async function locks() {   // app.py _cosm_locks: Shop items until bought, Plus items without Plus, everything for staff
  const cat = (await catalog).catalog, out = { cape: {}, wings: {}, hat: {}, pet: {} };
  if (access.staff) return out;
  for (const [kind, key] of [['cape', 'capes'], ['wings', 'wings'], ['hat', 'hats'], ['pet', 'pets']]) for (const it of cat[key] || []) {
    if (access.owned.includes(kind + ':' + it.id)) continue;
    if (it.plus && !access.plus) out[kind][it.id] = 'plus';
    else if (kind !== 'cape' && !it.plus) out[kind][it.id] = 'shop';
  }
  return out;
}
// Auoris Mind: a few made-up answers, typed out like a real reply
const ANSWERS = [
  [/\b(hi|hey|hello|yo)\b/i, 'Hi! 👋 I\'m **Auoris Mind**, the AI assistant in Auoris.\n\nThis is the website demo, so my answers here are made up. In the app I run on your PC with a local model through Ollama (your chats and files stay on your PC), or with cloud models if you add your own keys.'],
  [/minecraft|launcher|\bmods?\b/i,'In the app I can help with Minecraft too: explain a crash log, find a mod for your version, or set up a server.\n\nThe launcher itself is in **Auoris** (switch at the top of this page). Download Auoris to try it for real.'],
  [/code|python|javascript|script/i, 'Sure. Here is a tiny example:\n\n```python\nfor i in range(3):\n    print("Hello from Auoris Mind", i)\n```\n\nIn the app I can also read your files, run commands and fix the errors myself, after you allow it.'],
  [/./, 'That\'s a good question! This is only the website demo, so I can\'t really think here.\n\nIn the app I can:\n- chat with a local AI model on your PC or with cloud models\n- read files, run commands and browse the web when you allow it\n- run routines and work on projects with your friends\n\nDownload Auoris to talk to me for real.']];
async function fakeTurn(text) {
  turnStarted(); userMsg(text, []); assistantStart();
  const answer = ANSWERS.find(([re]) => re.test(text))[1], t0 = Date.now();
  await later(500);
  for (const piece of answer.match(/[\s\S]{1,6}/g)) { contentChunk(piece, 1); await later(18); }
  const secs = (Date.now() - t0) / 1000;
  assistantEnd(false, { in: 120, out: answer.length / 4 | 0, secs });
  turnDone(false, { in: 120, out: answer.length / 4 | 0, steps: 1, secs });
}

const LISTS = new Set(['list_chats', 'list_routines', 'personas_list', 'plugins_list', 'list_plugins', 'list_artifacts', 'prompts_list', 'installed_models', 'list_models',
  'background_tasks', 'dl_jobs', 'mc_running', 'mc_inuse', 'provider_accounts', 'mcp_state', 'ai_agents', 'pets_memories', 'pets_history']);
const ACTIONS = new Set(['mc_add_custom_mod', 'mc_pick_optifine', 'mc_open_folder', 'mc_open_custom_mods', 'mc_open_log', 'mc_collect_logs', 'mc_sign_in', 'mc_add_offline',
  'mc_switch_account', 'mc_remove_account', 'mc_sign_out', 'mc_join_proof', 'mc_stop', 'install_update', 'beta_install', 'check_updates', 'pick_files', 'pick_folder',
  'pick_folder_path', 'pick_profile_image', 'set_cwd_dialog', 'open_data_folder', 'open_plugins_folder', 'open_mic_settings', 'open_game_link', 'join_roblox', 'export_chat',
  'export_all', 'save_json_export', 'dl_install_tool', 'dl_enqueue', 'ext_generate_code', 'ext_open_folder', 'phone_toggle', 'crash_open_folder', 'boost_apply',
  'boost_apply_all', 'ram_clean_now', 'benchmark_start', 'import_run', 'import_chats_pick', 'import_chats_run', 'aicli_install', 'aicli_login', 'oauth_listen',
  'browser_open', 'delete_model', 'win_close', 'win_minimize', 'win_toggle_max', 'close', 'run_agent_task', 'save_routine', 'run_routine', 'provider_save', 'mcp_save',
  'pets_create', 'folder_attach', 'add_dropped', 'send_now']);
const API = {
  init: async () => ({ ...PREFS, version: VERSION, ready: true, chat_id: '', mode: 'chat', incognito: false, usernames: [], cwd: '', model: 'llama3.2:3b',
    legal_accepted: (await legal).version, app_mode: MIND ? 'mind' : 'auoris' }),
  set_setting: (k, v) => { PREFS[k] = v; return true; },
  legal_get: () => legal,
  acct_config: () => ({ url: 'https://demo.invalid', key: 'demo' }),
  open_url: url => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener'); },
  mind_installed: () => true,
  mind_open: () => { location.href = 'app.html?mind'; },
  send: text => { fakeTurn(text); return { ok: true }; },
  log_js_error: (...a) => console.warn('app error', ...a),
  chat_ext_state: () => ({ persona: null, folder: null, cloud: false }),
  dl_tools: () => ({ ollama: true, ollama_running: true, llamacpp: false, huggingface: true, busy: {} }),
  hf_search: () => ({ error: DEMO_MSG }),
  browser_state: () => ({ ready: true, url: '' }),
  mc_versions: () => ['26.3', '1.21.11', '1.12.2', '1.8.9', '1.7.10'],
  mc_installed: () => ({ '26.3': false, '1.21.11': true, '1.12.2': false, '1.8.9': true, '1.7.10': false }),
  mc_profile: () => ({ id: '0f5b1a9e2c3d4e5f8a9b0c1d2e3f4a5b', name: 'AuorisDemo' }),
  mc_accounts: () => [{ id: '0f5b1a9e2c3d4e5f8a9b0c1d2e3f4a5b', name: 'AuorisDemo', current: true, offline: false }],
  mc_default_skin: () => steve,
  mc_skin: async () => { const d = await steve; return d && { data: d, slim: false, name: 'AuorisDemo' }; },
  mc_skin_by_name: async name => { const d = await steve; return d && { data: d, slim: false, name }; },
  mc_cosmetics_data: () => cosmetics,
  mc_set_cosmetic_access: (staff, plus, owned) => { access = { staff: !!staff, plus: !!plus, owned: owned || [] }; return locks(); },
  mc_set_cosmetics: sel => { PREFS.mc_cosmetics = sel; return true; },
  mc_hero_bg: id => /^[a-z-]{1,40}$/.test(id) ? 'bg/' + id + '.jpg' : '',
  mc_news: async () => { try { return { releases: (await getJson('/changelog.json')).releases.slice(0, 8) }; } catch (e) { return { error: 'Couldn\'t load the changelog.' }; } },
  mc_servers: () => SERVERS.slice(),
  mc_server_status: () => later(1200, Object.fromEntries(SERVERS.map(s => [s.ip, STATUS[s.ip] || null]))),
  mc_server_edit: (old, neu) => {
    const i = old ? SERVERS.findIndex(s => s.ip === old.ip && s.name === old.name) : -1;
    if (neu) {
      const s = { name: String(neu.name || '').trim() || 'Minecraft Server', ip: String(neu.ip || '').trim(), icon: '', last: 0 };
      if (!s.ip) return { error: 'Type the server address.' };
      if (i >= 0) SERVERS[i] = s; else SERVERS.push(s);
    } else if (i >= 0) SERVERS.splice(i, 1);
    return SERVERS.slice();
  },
  mc_custom_mods: v => (MODS[v] || []).map(m => ({ ...m })),
  mc_toggle_custom_mod: (v, name, on) => { const m = (MODS[v] || []).find(x => x.name === name); if (m) m.on = !!on; return true; },
  mc_remove_custom_mod: (v, name) => { MODS[v] = (MODS[v] || []).filter(x => x.name !== name); return true; },
  mc_launch: () => {   // shows the start of a launch, then says it's a demo
    setTimeout(() => mcProgress('Checking game files…'), 500);
    setTimeout(() => { mcProgress(''); mcLaunchBtnReset(); demoToast(); }, 1600);
  },
  mc_cancel_launch: () => ({ ok: false }),
};
window.pywebview = {
  api: new Proxy({}, { get: (_, name) => {
    if (typeof name !== 'string') return undefined;
    return (...args) => {
      if (API[name]) return Promise.resolve().then(() => API[name](...args));
      if (ACTIONS.has(name)) { demoToast(); return never(); }
      return Promise.resolve(LISTS.has(name) ? [] : null);
    };
  } }),
};
// ui.html cancels every navigation of its page; the demo page's switch between Auoris and Auoris Mind reloads this page, so that one
// goes through (this listener runs before the app's)
if (window.navigation) navigation.addEventListener('navigate', e => {
  const u = new URL(e.destination.url);
  if (u.origin === location.origin && u.pathname === location.pathname) e.stopImmediatePropagation();
});
// the app starts when pywebview says its bridge is ready
window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.dispatchEvent(new Event('pywebviewready')), 0));
})();
