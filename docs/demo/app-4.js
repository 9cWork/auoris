
// ================================================================ plugin system
// Third-party plugins are .js files the user drops in %APPDATA%\Auoris\plugins (see app.py's
// list_plugins/read_plugin_source/open_plugins_folder - all read-only, scoped to that one folder).
// Auoris has no real Python-side sandbox for arbitrary code, so plugins never get Python execution and
// never touch window.pywebview.api directly. Instead each plugin runs inside its own <iframe sandbox="allow-scripts">
// with NO "allow-same-origin" - that gives it a unique opaque origin, so it cannot reach this page's
// window/document/pywebview bridge at all, only postMessage. A strict CSP in the iframe additionally blocks
// all network access (fetch/XHR/WebSocket/images/etc.), so a plugin can't phone data home even if it wanted to.
// The plugin only ever sees the small AuorisPlugins object defined in PLUGIN_FRAME_HTML below:
//   registerCommand(name, desc, handler) - adds a /command; handler(arg) runs when the user picks it
//   onChatMessage(callback)              - read-only notice of {role:'user'|'assistant', text} as chats happen
//   showToast(title, body)               - shows an Auoris toast
// Nothing else is exposed - no run_command, no file access, no API keys/session tokens, no fetch to arbitrary origins.
const PLUGIN_FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
</head><body><script>
"use strict";
const handlers = {}; const chatCbs = [];
function send(type, data) { parent.postMessage(Object.assign({ type }, data), '*'); }
const AuorisPlugins = Object.freeze({
  registerCommand(name, desc, handler) {
    if (typeof name !== 'string' || name[0] !== '/' || typeof handler !== 'function') return false;
    handlers[name] = handler; send('registerCommand', { name, desc: String(desc || '') }); return true;
  },
  onChatMessage(cb) { if (typeof cb !== 'function') return false; chatCbs.push(cb); return true; },
  showToast(title, body) { send('toast', { title: String(title == null ? '' : title), body: String(body == null ? '' : body) }); },
});
const pconsole = {
  log: function () { send('log', { level: 'log', text: Array.prototype.map.call(arguments, String).join(' ') }); },
  warn: function () { send('log', { level: 'warn', text: Array.prototype.map.call(arguments, String).join(' ') }); },
  error: function () { send('log', { level: 'error', text: Array.prototype.map.call(arguments, String).join(' ') }); },
};
window.addEventListener('message', function (ev) {
  const d = ev.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'load') {
    try {
      new Function('AuorisPlugins', 'console', '"use strict";\\n' + d.src)(AuorisPlugins, pconsole);
      send('ready', {});
    } catch (e) { send('loadError', { message: String((e && e.message) || e) }); }
  } else if (d.type === 'invoke') {
    const h = handlers[d.cmd];
    if (h) {
      try { Promise.resolve(h(d.arg)).catch(function (e) { send('log', { level: 'error', text: String((e && e.message) || e) }); }); }
      catch (e) { send('log', { level: 'error', text: String((e && e.message) || e) }); }
    }
  } else if (d.type === 'chat') {
    chatCbs.forEach(function (cb) { try { cb({ role: d.role, text: d.text }); } catch (e) {} });
  }
});
send('boot', {});
<\/script></body></html>`;

const pluginState = { frames: {}, sources: {}, names: {}, list: [], frameIds: new Map() };

function pluginCommandEntry(pluginId, name, desc) {
  // the frame can post anything, not just what registerCommand checks: a non-string name broke the whole / menu
  if (typeof name !== 'string' || !/^\/[\w-]{1,32}$/.test(name)) return;
  if (COMMANDS.some(c => c.cmd === name)) return;  // no stomping on built-ins or another plugin's command
  COMMANDS.push({
    cmd: name, desc: String(desc || '').slice(0, 200), pluginId,
    run: arg => { const f = pluginState.frames[pluginId]; if (f) f.contentWindow.postMessage({ type: 'invoke', cmd: name, arg: arg || '' }, '*'); },
  });
}

function firePluginChatEvent(role, text) {
  for (const id in pluginState.frames) {
    try { pluginState.frames[id].contentWindow.postMessage({ type: 'chat', role, text: String(text || '') }, '*'); } catch (e) {}
  }
}

window.addEventListener('message', ev => {
  const d = ev.data;
  if (!d || typeof d !== 'object') return;
  const id = pluginState.frameIds.get(ev.source);
  if (!id) return;  // not one of ours
  if (d.type === 'boot') ev.source.postMessage({ type: 'load', src: pluginState.sources[id] || '' }, '*');
  else if (d.type === 'registerCommand') pluginCommandEntry(id, d.name, d.desc);
  else if (d.type === 'toast') toast(`🧩 ${pluginState.names[id] || id}`, d.title ? (d.body ? `${d.title}: ${d.body}` : d.title) : (d.body || ''));
  else if (d.type === 'log') console[d.level === 'error' ? 'error' : d.level === 'warn' ? 'warn' : 'log'](`[plugin:${id}]`, d.text);
  else if (d.type === 'loadError') { console.error(`[plugin:${id}] failed to load`, d.message); toast('Plugin error', `${pluginState.names[id] || id}: ${d.message}`); }
});

async function loadPlugins() {
  let list = [];
  try { list = await api().list_plugins() || []; } catch (e) { return; }
  pluginState.list = list;
  const disabled = new Set(prefs.disabled_plugins || []);
  for (const p of list) {
    if (disabled.has(p.id)) continue;
    let src = null;
    try { src = await api().read_plugin_source(p.id); } catch (e) { src = null; }
    if (!src) continue;
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';  // deliberately NOT allow-same-origin - keeps it a separate opaque origin
    iframe.style.display = 'none';
    iframe.title = `plugin:${p.id}`;
    document.body.appendChild(iframe);
    pluginState.frames[p.id] = iframe; pluginState.sources[p.id] = src; pluginState.names[p.id] = p.name || p.id;
    pluginState.frameIds.set(iframe.contentWindow, p.id);
    iframe.srcdoc = PLUGIN_FRAME_HTML;
  }
}

async function renderPluginList() {
  const list = pluginState.list.length ? pluginState.list : (pluginState.list = (await api().list_plugins()) || []);
  const disabled = new Set(prefs.disabled_plugins || []);
  $('pluginList').innerHTML = list.length ? list.map(p => `
    <div class="setrow" data-id="${esc(p.id)}">
      <label class="chk"><input type="checkbox" class="plugToggle" ${disabled.has(p.id) ? '' : 'checked'}>
        <span><span>${esc(p.name)}${p.version ? ` <small class="vsub">v${esc(p.version)}</small>` : ''}</span>
        <small>${esc(p.description) || 'No description.'}${p.author ? ' — ' + esc(p.author) : ''}</small></span>
      </label>
    </div>`).join('') : `<div class="vsub">No plugins installed yet. Drop a .js file (and optional matching .json manifest) into the plugins folder below.</div>`;
  $('pluginList').querySelectorAll('.plugToggle').forEach(cb => cb.onchange = async () => {
    const id = cb.closest('[data-id]').dataset.id;
    const set = new Set(prefs.disabled_plugins || []);
    if (cb.checked) set.delete(id); else set.add(id);
    prefs.disabled_plugins = [...set];
    await api().set_setting('disabled_plugins', prefs.disabled_plugins);
    toast('Plugins', 'Restart Auoris for this change to take effect.');
  });
}
