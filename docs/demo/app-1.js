
const $ = id => document.getElementById(id);
// The app window never leaves this page: pywebview gives window.pywebview.api to whatever page the window shows, so a stray link,
// a meta refresh or a location change in rendered content must not navigate it. A web link the user clicked opens via openLink instead.
if (window.navigation) navigation.addEventListener('navigate', e => {
  if (e.destination.sameDocument || !e.cancelable) return;
  e.preventDefault();
  if (e.userInitiated && /^https?:\/\//i.test(e.destination.url)) openLink(e.destination.url);
});
const outside = (d, e) => { if (e.target !== d) return false; const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
const log = $('log'), chat = $('chat'), input = $('input');
let busy = false, cur = null, cmdPre = null, chatId = null, allChats = [];
let pendingMode = null, busyToastAt = 0;   // a Chat/Code switch asked for during a cloud reply, and the last "busy" toast
const tools = {};
const PLACEHOLDER = input.placeholder;
const TOOL_ICON = { ask_model: '✦', spawn_agent: '🤖', wait_agents: '⏳', list_directory: '📁', read_file: '📄', write_file: '✎', edit_file: '✎', search_files: '⌕', run_command: '›_', change_directory: '↪', stop_process: '■', open_in_browser: '🌐', fetch_url: '🌐' };
const TOOL_LABEL = { ask_model: 'Ask model', spawn_agent: 'Sub-agent', wait_agents: 'Wait for agents', list_directory: 'List', read_file: 'Read', write_file: 'Write', edit_file: 'Edit', search_files: 'Search', run_command: 'Run', change_directory: 'Cd', stop_process: 'Stop', open_in_browser: 'Open', fetch_url: 'Web page' };

function api() { return window.pywebview.api; }
// A URL that is safe inside style="...": other users control avatar/banner URLs, so only https, and every character that could
// close the url('...') or the declaration is percent-encoded (entity-escaping is no use here: the browser decodes entities first).
function cssUrl(u) {
  u = String(u == null ? '' : u);
  if (!/^https:\/\//i.test(u) || u.length > 600) return 'none';
  return "url('" + esc(u.replace(/[^A-Za-z0-9\-._~:\/?#\[\]@!$&*+,=%]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))) + "')";
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function nearBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120; }
function scroll(force) { if (force || nearBottom()) chat.scrollTop = chat.scrollHeight; }
function clearEmpty() { const e = $('empty'); if (e) e.remove(); }
function showEmpty() {
  log.innerHTML = `<div class="empty" id="empty">
    <svg class="hero" width="150" height="150" viewBox="0 0 256 256">
      <g class="bob">
        <g class="moon"><use href="#moonBody"/></g>
        <circle class="flash" cx="90" cy="90" r="34" fill="url(#gFlash)"/>
        <g class="ast"><use href="#asteroid"/></g>
      </g>
    </svg>
    <h1></h1><div class="esub"></div>
    <div class="sugg"></div>${incognito ? `<div class="incogbanner">${esc(t('incogBanner'))}</div>` : ''}<i class="orbit o2"></i><i class="orbit o1"></i></div>`;
  const nm = (prefs.call_me || prefs.profile_name || '').trim();
  log.querySelector('h1').textContent = mode === 'chat' ? t('emptyChat').replace('{name}', nm ? ', ' + nm : '') : t('emptyCode');
  log.querySelector('.esub').textContent = t(mode === 'chat' ? 'emptyChatSub' : 'emptyCodeSub');
  log.querySelector('.sugg').innerHTML = t(mode === 'chat' ? 'suggChat' : 'sugg').map(s => `<button>${esc(s)}</button>`).join('');
  log.querySelectorAll('.sugg button').forEach(b => b.onclick = () => { input.value = b.textContent; autosize(); input.focus(); });
}

// ---- logo easter egg (click the moon/asteroid on the empty-chat screen) ----
// ---- sound effects: everything is synthesized with Web Audio (no audio files, nothing to download).
// Recipes are [frequency Hz, start s, duration s, waveform, gain]; tools/generate_sfx_previews.py renders the same
// recipes to WAV so they can be auditioned outside the app - keep the two in sync if you change one.
const Sfx = (() => {
  const RECIPES = {
    ping:    [[1318.5, 0, .18, 'sine', .5], [1760, .09, .32, 'sine', .5]],
    mention: [[1318.5, 0, .15, 'sine', .5], [1760, .08, .15, 'sine', .5], [2093, .16, .38, 'sine', .5]],
    send:    [[880, 0, .06, 'sine', .35], [1174.7, .04, .09, 'sine', .3]],
    done:    [[880, 0, .10, 'triangle', .4], [1318.5, .10, .28, 'triangle', .4]],
    connect: [[523.25, 0, .10, 'sine', .45], [783.99, .09, .10, 'sine', .45], [1046.5, .18, .28, 'sine', .45]],
    end:     [[783.99, 0, .12, 'sine', .45], [587.33, .11, .12, 'sine', .45], [392, .22, .32, 'sine', .45]],
    ring:    [[659.3, 0, .22, 'triangle', .45], [783.99, .25, .22, 'triangle', .45], [987.77, .5, .22, 'triangle', .45],
              [783.99, .75, .22, 'triangle', .45], [1318.5, 1, .55, 'triangle', .45]],
    ringback: [[440, 0, .4, 'sine', .28], [480, 0, .4, 'sine', .28], [440, .6, .4, 'sine', .28], [480, .6, .4, 'sine', .28]],
  };
  const CYCLE = { ring: 2.6, ringback: 3.6 };
  let ctx = null, master = null, idleT = 0; const loops = {};
  const enabled = () => typeof prefs !== 'undefined' && !!prefs;   // no on/off switch: Do not disturb (or 0% volume) silences sounds
  const volume = () => { const v = prefs && prefs.sfx_volume; return Math.max(0, Math.min(1, (v == null ? 60 : v) / 100)); };
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    master.gain.value = volume();
    // A running context keeps an audio thread and the sound device busy even when silent: suspend it 6 s after the last sound
    // (longer than any recipe or the egg; ring loops replay every <= 3.6 s, so a ringing call never gets suspended).
    clearTimeout(idleT); idleT = setTimeout(() => ctx.suspend().catch(() => {}), 6000);
    return ctx;
  }
  function note(f, t0, dur, type, g, dest) {
    const o = ctx.createOscillator(), a = ctx.createGain(), t = ctx.currentTime + t0;
    o.type = type; o.frequency.value = f;
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + .006); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest || master); o.start(t); o.stop(t + dur + .05);
  }
  function egg() {
    // whoosh (rising filtered noise) -> sub boom -> shimmering pad -> sparkle arpeggio, timed to the logo animation
    const len = Math.floor(ctx.sampleRate * 1.2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain(), t = ctx.currentTime;
    src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(200, t); bp.frequency.exponentialRampToValueAtTime(5000, t + 1);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(.55, t + .9); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    src.connect(bp); bp.connect(ng); ng.connect(master); src.start(t);
    const boom = ctx.createOscillator(), bg = ctx.createGain();
    boom.frequency.setValueAtTime(90, t + .9); boom.frequency.exponentialRampToValueAtTime(32, t + 2.2);
    bg.gain.setValueAtTime(0.0001, t + .9); bg.gain.exponentialRampToValueAtTime(.9, t + .93); bg.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    boom.connect(bg); bg.connect(master); boom.start(t + .9); boom.stop(t + 2.4);
    const pad = ctx.createBiquadFilter(); pad.type = 'lowpass'; pad.frequency.value = 1400; pad.connect(master);
    [523.25, 659.25, 783.99].forEach(f => note(f, .9, 2.1, 'sawtooth', .07, pad));
    [1046.5, 1318.5, 1568, 2093, 2637, 3136].forEach((f, i) => note(f, 1 + i * .09, .55, 'sine', .22));
  }
  function play(name) {
    if (!enabled() || !ensure()) return;
    if (name === 'egg') return egg();
    (RECIPES[name] || []).forEach(([f, t0, dur, type, g]) => note(f, t0, dur, type, g));
  }
  function startLoop(name) {
    if (!enabled() || loops[name] || !ensure()) return;
    play(name); loops[name] = setInterval(() => play(name), CYCLE[name] * 1000);
  }
  function stopLoop(name) { if (loops[name]) { clearInterval(loops[name]); delete loops[name]; } }
  // Browsers only let audio start after a user gesture - unlock the context on the first click/keypress.
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => ensure(), { once: true, capture: true }));
  // fromId (optional) = the user a sound is about: blocked/muted people never make a sound (isQuietUser lives with the account code).
  const quiet = id => !!id && typeof isQuietUser === 'function' && isQuietUser(id);
  return { play: (name, fromId) => { if (!quiet(fromId)) play(name); }, startLoop: (name, fromId) => { if (!quiet(fromId)) startLoop(name); },
           stopLoop, stopAll: () => Object.keys(loops).forEach(stopLoop) };
})();

let eggPlaying = false;
document.addEventListener('click', e => {
  const hero = e.target.closest('.empty .hero');
  if (hero) playLogoEgg(hero);
});
// The asteroid breaks away from the moon, tears around the whole screen on a curving path trailing fire, then dives back into the moon:
// impact flash + shockwave + screen shake, and the moon shatters into shards that fly off before it fades back in.
function eggSprite(symId, skip) {
  const sym = document.getElementById(symId), svg = sym && sym.ownerSVGElement, defs = svg && svg.querySelector('defs');
  if (!sym || !defs) return Promise.resolve(null);
  const ser = new XMLSerializer();
  const body = [...sym.children].filter((_, k) => !(skip || []).includes(k)).map(n => ser.serializeToString(n)).join('');
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">${ser.serializeToString(defs)}${body}</svg>`;
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src); });
}
async function playLogoEgg(hero) {
  if (eggPlaying) return;
  const reduced = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.body.classList.contains('calm');
  if (reduced) {
    // calm / reduced-motion: a brief, subtle glow instead of the full spectacle
    hero.style.transition = 'filter .5s, transform .5s';
    hero.style.filter = 'drop-shadow(0 0 26px var(--acc-glow)) brightness(1.3)';
    hero.style.transform = 'scale(1.08)';
    setTimeout(() => { hero.style.filter = ''; hero.style.transform = ''; }, 550);
    return;
  }
  eggPlaying = true;
  const [moonImg, rockImg] = await Promise.all([eggSprite('moonBody', [0]), eggSprite('asteroid', [0, 1])]);   // moon without its glow disc, rock without the painted trail
  if (!moonImg || !rockImg) { eggPlaying = false; return; }
  Sfx.play('egg');
  const r = hero.getBoundingClientRect(), k = r.width / 256;
  const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
  const mx = r.left + 146 * k, my = r.top + 146 * k, MR = 80 * k;           // the moon
  const ax = r.left + 82 * k, ay = r.top + 82 * k;                           // where the asteroid starts
  const cv = document.createElement('canvas');
  cv.id = 'eggOverlay'; cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  document.body.appendChild(cv);
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  hero.style.visibility = 'hidden';
  const rnd = (a, b) => a + Math.random() * (b - a), TAU = Math.PI * 2;

  // flight path: a curving tour of the screen that finishes by diving at the moon
  const pts = [[ax, ay], [W * .12, H * .16], [W * .5, H * .08], [W * .9, H * .22], [W * .86, H * .78], [W * .45, H * .9], [W * .1, H * .66], [W * .3, H * .34], [mx - MR * .2, my - MR * .2], [mx, my]];
  const spl = (u) => {   // Catmull-Rom through pts, u in 0..1
    const n = pts.length - 1, f = u * n, i = Math.min(n - 1, Math.floor(f)), s = f - i;
    const P = x => pts[Math.max(0, Math.min(n, x))];
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    const q = (A, B, C, D) => .5 * ((2 * B) + (-A + C) * s + (2 * A - 5 * B + 4 * C - D) * s * s + (-A + 3 * B - 3 * C + D) * s * s * s);
    return [q(a[0], b[0], c[0], d[0]), q(a[1], b[1], c[1], d[1])];
  };
  const T_WIND = 350, T_FLY = 2900, T_HIT = T_WIND + T_FLY, T_END = T_HIT + 2700;
  const trail = [], sparks = [], embers = [];
  let shards = null, shockT = -1, shaken = false;

  function buildShards() {
    const RINGS = [0, .36, .7, 1], N = 12, grid = [];
    for (let ri = 0; ri < RINGS.length; ri++) {
      const row = [];
      for (let a = 0; a < N; a++) {
        const ang = (a + (ri === 0 ? 0 : rnd(-.3, .3))) / N * TAU;
        const rad = ri === 0 ? 0 : ri === RINGS.length - 1 ? 1 : RINGS[ri] * rnd(.82, 1.14);
        row.push([Math.cos(ang) * rad * MR, Math.sin(ang) * rad * MR]);
      }
      grid.push(row);
    }
    const polys = [];
    for (let a = 0; a < N; a++) {
      const b = (a + 1) % N;
      polys.push([[0, 0], grid[1][a], grid[1][b]]);
      polys.push([grid[1][a], grid[2][a], grid[2][b], grid[1][b]]);
      polys.push([grid[2][a], grid[3][a], grid[3][b], grid[2][b]]);
    }
    const hx = ax - mx, hy = ay - my, hl = Math.hypot(hx, hy) || 1;   // the rock hits from its side of the moon
    return polys.map(pl => {
      const cx = pl.reduce((s, q) => s + q[0], 0) / pl.length, cy = pl.reduce((s, q) => s + q[1], 0) / pl.length;
      const dx = cx - hx / hl * MR * .85, dy = cy - hy / hl * MR * .85, dist = Math.hypot(dx, dy) || 1;
      const sp = rnd(2.5, 7) * (1.25 - Math.min(1, dist / (MR * 2))) * (MR / 60) + rnd(.5, 2);
      const away = Math.atan2(cy + rnd(-8, 8), cx + rnd(-8, 8)) , push = Math.atan2(-hy / hl, -hx / hl);
      const dir = Math.atan2(Math.sin(away) * .6 + Math.sin(push) * .5, Math.cos(away) * .6 + Math.cos(push) * .5);
      return { pl, cx, cy, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp - 1.2, rot: 0, vr: rnd(-.18, .18), x: 0, y: 0, life: rnd(1900, 2500) };
    });
  }
  const burst = (x, y, n, power, cols) => {
    for (let q = 0; q < n; q++) { const a = rnd(0, TAU), v = rnd(.4, 1) * power; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(500, 1300), age: 0, s: rnd(1.5, 4), c: cols[q % cols.length] }); }
  };

  const t0 = performance.now();
  let last = t0;
  function frame(now) {
    try { frameInner(now); } catch (e) { console.error(e); cv.remove(); hero.style.visibility = ''; eggPlaying = false; }
  }
  function frameInner(now) {
    if (!document.body.contains(cv)) { hero.style.visibility = ''; eggPlaying = false; return; }
    const t = now - t0, dt = Math.min(48, now - last) / 16.67; last = now;
    g.clearRect(0, 0, W, H);

    // ---- moon (until it shatters)
    if (t < T_HIT) {
      let wob = 0, glow = 1;
      if (t < T_WIND) wob = Math.sin(t / 35) * 2.2 * (t / T_WIND);          // the moon shudders as the rock tears loose
      else if (t > T_HIT - 500) wob = Math.sin(t / 28) * 3 * ((t - (T_HIT - 500)) / 500);   // and braces as it comes back
      const gl = g.createRadialGradient(mx, my, MR * .9, mx, my, MR * 1.7);
      gl.addColorStop(0, 'rgba(91,157,255,.45)'); gl.addColorStop(1, 'rgba(91,157,255,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(mx + wob, my, MR * 1.7, 0, TAU); g.fill();
      g.drawImage(moonImg, mx + wob - 146 * k, my - 146 * k, 256 * k, 256 * k);
    }

    // ---- asteroid
    if (t < T_HIT) {
      let x, y, sc, ang;
      if (t < T_WIND) {   // shakes loose, backs off the moon
        const u = t / T_WIND; x = ax - u * 22 * k + rnd(-1, 1) * 2; y = ay - u * 22 * k + rnd(-1, 1) * 2; sc = 1 + u * .25; ang = u * 2;
      } else {
        const u = (t - T_WIND) / T_FLY, e = u < .85 ? u * 0.85 / .85 : .85 + Math.pow((u - .85) / .15, 2.2) * .15;   // steady, then a fast dive
        const e2 = Math.min(1, Math.max(0, e));
        [x, y] = spl(e2);
        sc = 1.25 + Math.sin(e2 * TAU * 1.5) * .7 + (e2 > .88 ? (e2 - .88) * 6 : 0);   // swoops closer and further away
        ang = e2 * 22;
        if (Math.random() < .9) embers.push({ x, y, vx: rnd(-.6, .6), vy: rnd(-.6, .6), life: rnd(350, 800), age: 0, s: rnd(1.5, 3.6) * sc });
      }
      trail.push([x, y, sc]); if (trail.length > 46) trail.shift();
      // fiery tail: fading ribbon of glowing circles
      for (let q = 0; q < trail.length; q++) {
        const f = q / trail.length, [tx, ty, ts] = trail[q];
        g.globalAlpha = f * .55; g.fillStyle = f > .7 ? '#fff0c8' : f > .4 ? '#ffb35c' : '#ff6a3d';
        g.beginPath(); g.arc(tx, ty, (4 + 14 * f) * ts * k * 1.2, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      const hal = g.createRadialGradient(x, y, 0, x, y, 46 * sc * k);
      hal.addColorStop(0, 'rgba(255,200,120,.75)'); hal.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = hal; g.beginPath(); g.arc(x, y, 46 * sc * k, 0, TAU); g.fill();
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(sc, sc);
      g.drawImage(rockImg, -82 * k, -82 * k, 256 * k, 256 * k);
      g.restore();
    }

    // ---- impact
    if (t >= T_HIT && !shards) {
      shards = buildShards(); shockT = t;
      burst(mx, my, 90, 9 * (MR / 60), ['#ffffff', '#ffe2a8', '#ffb35c', '#ff6a3d', '#7fb4ff']);
      document.body.classList.remove('eggShake'); void document.body.offsetWidth; document.body.classList.add('eggShake');
      setTimeout(() => document.body.classList.remove('eggShake'), 450);
      shaken = true;
    }
    if (shards) {
      const ts = t - T_HIT;
      // white flash + shockwave rings
      if (ts < 420) { const a = 1 - ts / 420, fl = g.createRadialGradient(mx, my, 0, mx, my, MR * 3.2); fl.addColorStop(0, `rgba(255,255,255,${a})`); fl.addColorStop(.35, `rgba(255,214,150,${a * .6})`); fl.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = fl; g.beginPath(); g.arc(mx, my, MR * 3.2, 0, TAU); g.fill(); }
      for (let ri = 0; ri < 2; ri++) {
        const u = (ts - ri * 140) / 900; if (u < 0 || u > 1) continue;
        g.globalAlpha = (1 - u) * .8; g.lineWidth = (1 - u) * 7 + 1; g.strokeStyle = ri ? '#7fb4ff' : '#fff2d8';
        g.beginPath(); g.arc(mx, my, MR * (.9 + u * 3.6), 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
      // shards: the moon's own picture clipped to each piece
      for (const s of shards) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += .06 * dt; s.vx *= Math.pow(.992, dt); s.rot += s.vr * dt;
        const al = Math.max(0, Math.min(1, (s.life - ts) / 600)); if (al <= 0) continue;
        g.save(); g.globalAlpha = al;
        g.translate(mx + s.cx + s.x, my + s.cy + s.y); g.rotate(s.rot); g.translate(-s.cx, -s.cy);
        g.beginPath(); s.pl.forEach((q, qi) => qi ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath();
        g.save(); g.clip(); g.drawImage(moonImg, -146 * k, -146 * k, 256 * k, 256 * k); g.restore();
        g.lineWidth = 1.2; g.strokeStyle = 'rgba(190,225,255,.75)'; g.stroke();   // bright cracked edges
        g.restore();
      }
      g.globalAlpha = 1;
    }

    // ---- sparks / embers (additive glow)
    g.globalCompositeOperation = 'lighter';
    for (const arr of [embers, sparks]) {
      for (let q = arr.length - 1; q >= 0; q--) {
        const p = arr[q]; p.age += dt * 16.67; if (p.age > p.life) { arr.splice(q, 1); continue; }
        p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; if (arr === sparks) { p.vy += .05 * dt; p.vx *= .99; }
        const a = 1 - p.age / p.life; g.globalAlpha = a; g.fillStyle = p.c || (a > .5 ? '#ffd9a0' : '#ff7a3d');
        g.beginPath(); g.arc(p.x, p.y, p.s * (.4 + a * .6), 0, TAU); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;

    if (t < T_END) { requestAnimationFrame(frame); return; }
    // the moon re-forms where it was
    cv.remove();
    hero.style.transition = 'none'; hero.style.opacity = '0'; hero.style.transform = 'scale(.6)'; hero.style.visibility = '';
    void hero.getBoundingClientRect();
    hero.style.transition = 'opacity .7s ease, transform .9s cubic-bezier(.2,1.4,.4,1), filter .9s'; hero.style.opacity = '1'; hero.style.transform = ''; hero.style.filter = 'drop-shadow(0 0 30px var(--acc-glow))';
    setTimeout(() => { hero.style.transition = ''; hero.style.opacity = ''; hero.style.filter = ''; eggPlaying = false; }, 1000);
  }
  requestAnimationFrame(frame);
}

// ---- tiny markdown renderer
function splitThink(src) {
  let think = '';
  const text = src.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, t) => { think += t; return ''; });
  return [think.trim(), text];
}
function md(src) {
  src = src.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '').replace(/[\u0000\u0001]/g, '');
  const blocks = []; let out = '';
  src = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><button class="copy" data-copy="1">copy</button><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const link = (href, text) => `<a class="xlink" href="${href}" title="${href}">${text}</a>`;
  const inline = s => esc(s).split(/(`[^`]+`)/).map(part => part.startsWith('`') && part.endsWith('`') && part.length > 1
    ? `<code>${part.slice(1, -1)}</code>`
    : (() => {
      const links = [], hold = h => `\u0001${links.push(h) - 1}\u0001`;
      return part
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => hold(link(u, t)))
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre, u) => pre + hold(link(u, u)))
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
        .replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i]);
    })()).join('');
  let list = null;
  for (const line of src.split('\n')) {
    const cb = line.match(/^\u0000(\d+)\u0000$/);
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (li) {
      const t = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== t) { if (list) out += `</${list}>`; out += `<${t}>`; list = t; }
      out += `<li>${inline(li[2])}</li>`; continue;
    }
    if (list) { out += `</${list}>`; list = null; }
    if (cb) out += blocks[+cb[1]];
    else if (h) out += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  if (list) out += `</${list}>`;
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}
function realText(el) {  // text with the username un-masked (copying a path should still work)
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let s = '', n;
  while ((n = w.nextNode())) s += (typeof origText !== 'undefined' && origText.get(n)) || n.nodeValue;
  return s;
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button.copy[data-copy]'); if (b) copyCode(b); });
// Copy that works inside the app window: the browser clipboard API is refused in some embedded pages, so fall back to a hidden text box, then to Windows itself.
async function copyText(text) {
  const t = String(text == null ? '' : text);
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) return true;
  } catch (e) { /* fall through */ }
  try { if (window.pywebview && api().clip_set) { const r = await api().clip_set(t); if (r && r.ok) return true; } } catch (e) { /* fall through */ }
  throw new Error('copy failed');
}
function copyCode(btn) {
  copyText(realText(btn.nextSibling)).then(() => { btn.textContent = 'copied'; }, () => { btn.textContent = 'failed'; toast('Copy failed', 'Select the code and press Ctrl+C instead.'); });
  setTimeout(() => btn.textContent = 'copy', 1500);
}

// ---- called from Python
// ---- custom title bar: move (native, supports snap), double-click maximize, resize edges
const ICON_MAX = '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>';
const ICON_RESTORE = '<svg viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/></svg>';
function setMaxed(m) {
  document.body.classList.toggle('maxed', !!m);
  $('maxBtn').innerHTML = m ? ICON_RESTORE : ICON_MAX; $('maxBtn').title = m ? 'Restore' : 'Maximize';
  $('mcMaxBtn').innerHTML = m ? ICON_RESTORE : ICON_MAX; $('mcMaxBtn').title = m ? 'Restore' : 'Maximize';
}
setMaxed(false);
$('minBtn').onclick = () => api().win_minimize();
$('maxBtn').onclick = () => api().win_toggle_max();
$('closeBtn').onclick = () => api().win_close();
$('mcMinBtn').onclick = () => api().win_minimize();
$('mcMaxBtn').onclick = () => api().win_toggle_max();
$('mcCloseBtn').onclick = () => api().win_close();
const NODRAG = 'button, input, select, textarea, a, .nodrag';
document.querySelectorAll('[data-drag]').forEach(el => {
  let down = null;
  el.addEventListener('mousedown', e => { down = (e.button === 0 && !e.target.closest(NODRAG)) ? [e.screenX, e.screenY] : null; });
  el.addEventListener('mousemove', e => {
    // start the native move only once the mouse actually moves, so double-click still works
    if (down && (e.buttons & 1) && Math.hypot(e.screenX - down[0], e.screenY - down[1]) > 3) { down = null; api().win_start_move(); }
  });
  el.addEventListener('mouseup', () => { down = null; });
  el.addEventListener('dblclick', e => { if (!e.target.closest(NODRAG)) api().win_toggle_max(); });
});
['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(edge => {
  const h = document.createElement('div'); h.className = 'rz ' + edge; document.body.appendChild(h);
  let st = null, busyRz = false, pending = null;
  const push = async () => {
    if (busyRz || !pending) return;
    busyRz = true; const b = pending; pending = null;
    try { await api().win_set_bounds(b.x, b.y, b.w, b.h); } finally { busyRz = false; push(); }
  };
  h.addEventListener('pointerdown', async e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    st = { sx: e.screenX, sy: e.screenY, b: null };
    st.b = await api().win_bounds();
  });
  h.addEventListener('pointermove', e => {
    if (!st || !st.b) return;
    const d = devicePixelRatio, dx = (e.screenX - st.sx) * d, dy = (e.screenY - st.sy) * d;
    const minW = 720 * d, minH = 480 * d;
    let { x, y, w, h: hh } = st.b;
    if (edge.includes('e')) w = Math.max(minW, st.b.w + dx);
    if (edge.includes('s')) hh = Math.max(minH, st.b.h + dy);
    if (edge.includes('w')) { w = Math.max(minW, st.b.w - dx); x = st.b.x + st.b.w - w; }
    if (edge.includes('n')) { hh = Math.max(minH, st.b.h - dy); y = st.b.y + st.b.h - hh; }
    pending = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) }; push();
  });
  const end = () => { st = null; };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
});

// ---- privacy: mask the Windows username everywhere it's displayed (display only; real text is kept for restore)
let maskNames = [], MASK_RE = null;
const MASK = '*****', origText = new WeakMap();
const maskFn = () => MASK;
const NOMASK = 'textarea, input, script, style';
function maskNode(n) {
  if (!MASK_RE) return;
  if (n.nodeType === 3) {
    if (n.parentElement && n.parentElement.closest(NOMASK)) return;
    const t = n.nodeValue; MASK_RE.lastIndex = 0;
    if (!MASK_RE.test(t)) return;
    const m = t.replace(MASK_RE, maskFn);
    if (!origText.has(n) || origText.get(n).replace(MASK_RE, maskFn) !== m) origText.set(n, t);
    n.nodeValue = m;
  } else if (n.nodeType === 1) {
    if (n.matches(NOMASK)) return;
    const title = n.getAttribute('title');
    if (title) { MASK_RE.lastIndex = 0; if (MASK_RE.test(title)) { n.dataset.otitle = title; n.setAttribute('title', title.replace(MASK_RE, maskFn)); } }
    for (const c of n.childNodes) maskNode(c);
  }
}
function unmaskTree(n) {
  if (n.nodeType === 3) { if (origText.has(n)) { n.nodeValue = origText.get(n); origText.delete(n); } }
  else if (n.nodeType === 1) {
    if (n.dataset && n.dataset.otitle) { n.setAttribute('title', n.dataset.otitle); delete n.dataset.otitle; }
    for (const c of n.childNodes) unmaskTree(c);
  }
}
function setMask(on) {
  const names = maskNames.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (on && names.length) {
    // also hide a half-typed name at the very end of a text (the AI streaming "C:\Users\bl" before the rest arrives), so no letters ever flash
    const part = [];
    for (const n of maskNames) for (let k = 1; k < n.length; k++) part.push(n.slice(0, k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    MASK_RE = new RegExp(`(?<![\\w])(${names.join('|')})(?![\\w])` + (part.length ? `|(?<=users[\\\\/])(?:${part.join('|')})$` : ''), 'gi');
    maskNode(document.body);
  }
  else { MASK_RE = null; unmaskTree(document.body); }
}
new MutationObserver(muts => {
  if (!MASK_RE) return;
  for (const m of muts) {
    if (m.type === 'characterData') maskNode(m.target);
    else if (m.type === 'attributes') { if (!m.target.dataset.otitle || m.target.getAttribute('title') !== m.target.dataset.otitle.replace(MASK_RE, maskFn)) maskNode(m.target); }
    else m.addedNodes.forEach(maskNode);
  }
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });

// ---- usage dialog
function gb(b) { return (b / 1073741824).toFixed(1) + ' GB'; }
async function openUsage() {
  const u = await api().get_usage();
  const card = (label, t) => `<div class="ucard"><div class="ulabel">${label}</div><div class="ubig">${fk(t.in + t.out)}</div>
    <div class="usub">${fk(t.out)} out · ${fk(t.in)} in · ${t.replies} repl${t.replies === 1 ? 'y' : 'ies'}</div></div>`;
  $('uCards').innerHTML = card('Today', u.today) + card('Last 7 days', u.week) + card('All time', u.all);
  const max = Math.max(1, ...u.chart.map(d => d.in + d.out));
  $('uChart').innerHTML = u.chart.map((d, i) => {
    const tot = d.in + d.out, lbl = new Date(d.day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="ubar" title="${lbl}: ${tot.toLocaleString()} tokens (${d.out.toLocaleString()} out, ${d.in.toLocaleString()} in)">
      <div class="ustack" style="height:${tot / max * 100}%; animation-delay:${i * 30}ms">
        <i class="lo" style="flex:${d.out}"></i><i class="li" style="flex:${d.in}"></i></div>
      <span>${i % 2 === 1 || i === 13 ? lbl.replace(/^\w+ /, '') : ''}</span></div>`;
  }).join('');
  const c = u.chat || {};
  $('uChat').innerHTML = c.replies ? `<div class="ubig sm">${fk((c.in || 0) + (c.out || 0))}</div>
    <div class="usub">${esc(u.chat_title || 'Current chat')}<br>${fk(c.out || 0)} out · ${fk(c.in || 0)} in · ${c.replies} replies</div>` : '<div class="usub">Nothing yet in this chat.</div>';
  if (u.loaded) {
    const pct = u.loaded.size ? Math.round(u.loaded.vram / u.loaded.size * 100) : 0;
    $('uVram').innerHTML = `<div class="ubig sm">${gb(u.loaded.vram)}</div><div class="usub">of ${gb(u.loaded.size)} on the GPU (${pct}%)` +
      `${pct < 100 ? ' — the rest runs on the CPU (slower)' : ''}<br>Context loaded: ${fk(u.loaded.ctx || u.active_ctx)} of max ${fk(u.max_ctx)}</div>`;
  } else $('uVram').innerHTML = '<div class="ubig sm">0 GB</div><div class="usub">Model not loaded (unloaded while idle). It loads again when you send a message.</div>';
  renderCloudUsage(u.cloud);
  renderByModel(u.bymodel, u.cloud);
  { let t = 'global'; try { t = sessionStorage.getItem('uTab') || 'global'; } catch (e) {} usageTab(['global', 'local', 'cloud', 'limits'].includes(t) ? t : 'global'); }
  $('usageDlg').showModal();
}
// what cheaper reviews would have saved over the last 30 days: reviews are roughly a third of a multi-model run's cost
function cheapSave(c) {
  const rows = Object.entries(c.month.models || {}).filter(([m, r]) => r.cost > 0);
  if (rows.length < 2) return '';
  const tot = rows.reduce((s, [, r]) => s + r.cost, 0), min = Math.min(...rows.map(([, r]) => r.cost / Math.max(1, r.in + r.out)));
  const toks = rows.reduce((s, [, r]) => s + r.in + r.out, 0), est = Math.max(0, (tot - min * toks) / 3);
  return est >= 0.01 ? ` <span class="usub">(about ${money(est)} less over the last 30 days)</span>` : '';
}
function renderCloudUsage(c) {
  const box = $('uCloud'); if (!box || !c) return;
  const sum = (lbl, s) => `<div class="ucard"><div class="ulabel">${lbl}</div><div class="ubig">${money(s.cost)}${s.unpriced ? '<small title="Some models have no price set">+</small>' : ''}</div>
    <div class="usub">${fk(s.in + s.out)} tokens · ${s.calls} request${s.calls === 1 ? '' : 's'}</div></div>`;
  const maxc = Math.max(0.0001, ...c.chart.map(d => d.cost));
  const budget = +c.budget || 0, spent = c.today.cost, over = budget && spent >= budget;
  box.innerHTML = `<div class="ucards">${sum('Today', c.today)}${sum('Last 7 days', c.week)}${sum('Last 30 days', c.month)}</div>
    <div class="uccost" title="Estimated cloud cost per day, last 14 days">${c.chart.map((d, i) => `<i style="height:${d.cost / maxc * 100}%;animation-delay:${i * 30}ms" title="${d.day}: ${money(d.cost)}"></i>`).join('')}</div>
    <div class="ubudget"><span>Daily budget</span><input id="uBudget" type="number" min="0" step="0.5" value="${budget || ''}" placeholder="no limit">
      <span class="${over ? 'uwarn' : 'usub'}">${budget ? (over ? `Used up today (${money(spent)}) - cloud requests are paused until tomorrow.` : `${money(spent)} of $${budget.toFixed(2)} used today`) : 'Cloud requests stop for the day once this much is spent.'}</span></div>`;
  box.insertAdjacentHTML('beforeend', `<div class="ulabel" style="margin-top:14px">Multi-model</div><div class="utoggles">
      <label class="chk"><input type="checkbox" id="uAuto" ${prefs.auto_mode ? 'checked' : ''}> <span><b>Auto mode</b> - use /extra or /team by itself when a message looks like it needs it (uses more of your cloud credit)</span></label>
      <label class="chk"><input type="checkbox" id="uCheap" ${c.cheap_reviews ? 'checked' : ''}> <span><b>Cheaper reviews</b> - the cheapest priced model does the reviewing and planning, the strong one still writes the answer${cheapSave(c)}</span></label></div>
    <div class="ulabel" style="margin-top:14px" title="Reviewers vote for the best draft in each /extra run">Your model leaderboard · picked as the best draft</div>
    <div class="uleader">${(c.leader || []).length ? c.leader.map(r => `<div class="urow"><span title="${esc(r.model)}">${esc(modelLabel(r.model))}</span>
      <small>${Object.entries(r.kinds).map(([k, v]) => `${esc(k)} ${v[1]}/${v[0]}`).join(' · ')}</small><b>${Math.round(r.wins / r.runs * 100)}%</b></div>`).join('')
      : '<div class="usub">Fills in as you use /extra. Models picked most often (after 3 runs) become the default from their provider.</div>'}</div>`);
  $('uAuto').onchange = async e => { prefs.auto_mode = e.target.checked; await api().set_setting('auto_mode', prefs.auto_mode); };
  $('uCheap').onchange = async e => { prefs.extra_cheap_reviews = e.target.checked; await api().set_setting('extra_cheap_reviews', prefs.extra_cheap_reviews); openUsage(); };
  $('uBudget').onchange = async e => { const v = Math.max(0, +e.target.value || 0); await api().set_setting('cloud_budget_day', v); openUsage(); };
}
// Usage by model: a "Local" and a "Cloud" dropdown, each with a dropdown per model (Today / 7 days / 30 days / All time).
// Everything comes from what Auoris recorded itself; cloud costs are estimates from the price list (or your own prices).
const PERIODS = [['today', 'Today'], ['week', '7 days'], ['month', '30 days'], ['all', 'All time']];
function renderByModel(b, c) {
  const box = $('usageDlg'); if (!$('uLocalBy') || !b) return;
  const tok = p => (p.in || 0) + (p.out || 0);
  const grid = (cols, head) => `<div class="ubm" style="grid-template-columns:96px repeat(4,1fr)"><span></span>${PERIODS.map(([, l]) => `<b>${l}</b>`).join('')}${cols}</div>`;
  const rowOf = (label, f, tip) => `<span title="${esc(tip || '')}">${label}</span>${PERIODS.map(([k]) => `<span>${f(k)}</span>`).join('')}`;
  const openState = () => { try { return JSON.parse(sessionStorage.getItem('uOpen') || '{}'); } catch (e) { return {}; } };
  const open = openState();
  const det = (id, cls, sum, body) => `<details class="${cls}" data-id="${esc(id)}" ${open[id] ? 'open' : ''}><summary>${sum}</summary>${body}</details>`;
  const lt = b.local.reduce((s, m) => s + tok(m.periods.all), 0);
  const localBody = b.local.length ? b.local.map(m => {
    const P = m.periods, tps = k => P[k].secs > 0 && P[k].out ? Math.round(P[k].out / P[k].secs) + ' tok/s' : '–';
    return det('l:' + m.model, 'umodel', `<span class="un" title="${esc(m.model)}">${esc(m.model.split('/').pop())}</span><small>${P.all.replies} repl${P.all.replies === 1 ? 'y' : 'ies'}</small><b>${fk(tok(P.all))}</b><em>Free</em>`,
      grid(rowOf('Tokens in', k => fk(P[k].in)) + rowOf('Tokens out', k => fk(P[k].out)) + rowOf('Replies', k => P[k].replies) + rowOf('Speed', tps, 'Generated tokens per second of answering time') + rowOf('Est. cost', () => 'Free', 'Local models run on your PC and cost nothing per token')));
  }).join('') : '<div class="usub">No local model usage yet.</div>';
  const cloudCost = b.cloud.reduce((s, m) => s + m.periods.all.cost, 0), unpriced = b.cloud.some(m => !m.plan && !m.price);
  const cloudBody = '<div id="uAcct"></div>' + (b.cloud.length ? b.cloud.map(m => {
    const P = m.periods, pr = (c.prices || {})[m.name] || m.price;
    const cost = k => m.plan ? 'plan' : (P[k].priced || P[k].cost > 0) ? money(P[k].cost) : '–';
    return det('c:' + m.model, 'umodel', `<span class="un" title="${esc(m.model)}">${esc(m.name)} <small>${esc(m.prov)}</small></span><small>${P.all.calls} request${P.all.calls === 1 ? '' : 's'}</small><b>${fk(tok(P.all))}</b><em>${m.plan ? 'plan' : (m.price || P.all.cost) ? money(P.all.cost) : 'no price'}</em>`,
      grid(rowOf('Tokens in', k => fk(P[k].in)) + rowOf('Tokens out', k => fk(P[k].out)) + rowOf('Requests', k => P[k].calls) +
           rowOf('Est. cost', cost, m.plan ? 'Used through your Claude Code / Codex / Gemini CLI plan: not charged per token' : 'Estimated from the price list (or your own prices) - your provider\'s bill is what counts')) +
      (m.plan ? '' : `<div class="uprice2"><span>Price per million tokens</span><input data-pm="${esc(m.model)}" data-k="0" value="${pr ? pr[0] : ''}" placeholder="in $"><input data-pm="${esc(m.model)}" data-k="1" value="${pr ? pr[1] : ''}" placeholder="out $"></div>`));
  }).join('') : '<div class="usub">No cloud requests yet.</div>');
  $('uLocalBy').innerHTML = localBody;
  $('uCloudBy').innerHTML = cloudBody;
  $('uTabLocal').textContent = b.local.length ? fk(lt) + ' · Free' : '';
  $('uTabCloud').textContent = b.cloud.length ? fk(b.cloud.reduce((s, m) => s + tok(m.periods.all), 0)) + ' · ' + money(cloudCost) + (unpriced ? '+' : '') : '';
  box.querySelectorAll('details').forEach(d => d.ontoggle = () => { const o = openState(); if (d.open) o[d.dataset.id] = 1; else delete o[d.dataset.id]; try { sessionStorage.setItem('uOpen', JSON.stringify(o)); } catch (e) {} });
  box.querySelectorAll('[data-pm]').forEach(inp => inp.onchange = async () => {
    const m = inp.dataset.pm.split('/').slice(1).join('/'), pr = Object.assign({}, prefs.model_prices || {});
    const ins = box.querySelectorAll(`[data-pm="${CSS.escape(inp.dataset.pm)}"]`), a = +ins[0].value, bb = +ins[1].value;
    if (ins[0].value === '' && ins[1].value === '') delete pr[m]; else pr[m] = [a || 0, bb || 0];
    prefs.model_prices = pr; await api().set_setting('model_prices', pr); toast('Prices', 'Saved - new requests use this price.');
  });
  api().provider_accounts().then(list => {   // what the provider itself reports (only OpenRouter and DeepSeek show it to a normal key)
    const el = $('uAcct'); if (!el || !list || !list.length) return;
    el.innerHTML = list.map(x => `<div class="uacct"><b>${esc(x.name)}</b> reports: ` + (x.balance !== undefined ? `balance ${esc(x.balance)} ${esc(x.unit)}`
      : `${money(+x.used || 0)} used${x.limit ? ` of ${money(+x.limit)}` : ''}${x.remaining != null ? ` · ${money(+x.remaining)} left` : ''}`) + '</div>').join('');
  }).catch(() => {});
}
function limitWhen(ts) {
  const s = ts - Date.now() / 1000; if (s <= 0) return 'now';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `in ${d} day${d === 1 ? '' : 's'}${h ? ' ' + h + ' h' : ''}` : h ? `in ${h} h ${m} min` : `in ${m} min`;
}
async function renderLimits() {
  const box = $('uLimits'); if (!box) return;
  let list = []; try { list = await api().usage_limits(); } catch (e) { box.innerHTML = '<div class="usub">Couldn\'t read the limits.</div>'; return; }
  box.innerHTML = list.map(a => {
    const d = a.data;
    const rows = d ? d.windows.map(w => {
      const pct = w.used == null ? null : Math.round(w.used), col = pct == null ? '' : pct >= 90 ? 'var(--err)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
      return `<div class="ulim"><div class="ulimh"><b>${esc(w.label)}</b><span>${pct == null ? esc(w.status || '') : pct + '% used'}</span></div>
        ${pct == null ? '' : `<div class="ulimbar"><i style="width:${Math.max(2, pct)}%;background:${col}"></i></div>`}
        <div class="usub">${w.reset ? 'Has reset since it was last checked' : w.resets ? 'Resets ' + limitWhen(w.resets) + ' (' + esc(new Date(w.resets * 1000).toLocaleString()) + ')' : ''}</div></div>`;
    }).join('') + (d.credits != null ? `<div class="usub">Credits: ${esc(d.credits)}</div>` : '') + (d.asof ? `<div class="usub">As of ${esc(new Date(d.asof * 1000).toLocaleString())}</div>` : '') : `<div class="usub">${esc(a.empty)}</div>`;
    return `<div class="usec"><div class="ulabel">${esc(a.name)} <small>${esc(a.sub)}</small></div>${rows}</div>`;
  }).join('');
}
function usageTab(t) {
  if (t === 'limits') renderLimits();
  document.querySelectorAll('#uTabs button').forEach(b => b.classList.toggle('on', b.dataset.ut === t));
  document.querySelectorAll('#usageDlg [data-upane]').forEach(p => { p.hidden = p.dataset.upane !== t; });
  try { sessionStorage.setItem('uTab', t); } catch (e) {}
}
document.querySelectorAll('#uTabs button').forEach(b => b.onclick = () => usageTab(b.dataset.ut));
$('usageClose').onclick = () => $('usageDlg').close();

// ---- @agents: a name, a model, instructions, and whether it may use tools (then it works in the background in its own chat)
async function agentsOpen(editName) {
  let d = $('agentsDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'agentsDlg'; document.body.appendChild(d); d.onclick = e => { if (outside(d, e)) d.close(); }; }
  await agentsRefresh();
  const list = agentCache.map(a => Object.assign({}, a));
  const ed = editName !== undefined ? (list.find(a => a.name === editName) || { name: '', model: prefs.model || '', instructions: '', tools: false }) : null;
  let models = { local: [], cloud: [] }; if (ed) { try { models = await api().models_all(); } catch (e) {} }
  const opt = (v, l) => `<option value="${esc(v)}" ${ed && ed.model === v ? 'selected' : ''}>${esc(l)}</option>`;
  d.innerHTML = `<div class="uhead"><h3>${ed ? (editName ? 'Edit @' + esc(editName) : 'New agent') : 'Your @agents'}</h3><button class="icon" id="agX" title="Close">✕</button></div>` + (ed ? `
    <label>Name (you type @name in chat)</label><input id="agName" maxlength="24" value="${esc(ed.name)}" placeholder="coder">
    <label>Model</label><select id="agModel">${models.local.length ? `<optgroup label="On this PC">${models.local.map(n => opt(n, modelLabel(n))).join('')}</optgroup>` : ''}
      ${models.cloud.filter(g => g.models.length).map(g => `<optgroup label="${esc(g.name)}">${g.models.map(m => opt(m.value, m.name || m.id)).join('')}</optgroup>`).join('')}
      ${ed.model && ![...models.local, ...models.cloud.flatMap(g => g.models.map(m => m.value))].includes(ed.model) ? opt(ed.model, modelLabel(ed.model)) : ''}</select>
    <label>Instructions (who it is and how it should answer)</label><textarea id="agInstr" placeholder="You are a senior Python developer. Answer with working code and short explanations.">${esc(ed.instructions)}</textarea>
    <label>Memory (it adds things worth remembering; edit or clear freely)</label><textarea id="agMem" maxlength="3000" placeholder="(nothing yet)">${esc(ed.memory || '')}</textarea>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="agTools" ${ed.tools ? 'checked' : ''}> <span>Can use tools (files, commands, web) - then it works in the background in its own chat, like /agent</span></label>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="agBack">Back</button><button class="primary" id="agSave">Save</button></div>` : `
    <p class="vsub">Type <b>@name your question</b> in chat to ask one. <b>@team</b> is built in (same as /team).</p>
    ${list.length ? list.map(a => `<div class="agrow"><span><b>@${esc(a.name)}</b> · ${esc(modelLabel(a.model))}${a.tools ? ' · 🛠 tools' : ''}</span>
      <button class="btn sm" data-share="${esc(a.name)}" title="Copy a code a friend can import">Share</button>
      <button class="btn sm" data-ed="${esc(a.name)}">Edit</button><button class="btn sm danger" data-rm="${esc(a.name)}">Delete</button></div>`).join('') : '<div class="vsub">No agents yet.</div>'}
    <label>Import a friend's agent</label><div class="row"><input id="agCode" placeholder="AUORIS-AGENT:..." style="flex:1"><button class="btn" id="agImport">Import</button></div>
    <label>Sub-agents the AI may run at once (Code mode, same as /agents 8)</label>
    <select id="agCap"><option value="auto">Auto</option><option value="off">Off</option>${Array.from({ length: 27 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
    <div class="vsub" id="agCapInfo"></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="primary" id="agNew">New agent</button></div>`);
  const save = async l => { prefs.ai_agents = l; await api().set_setting('ai_agents', l); await agentsRefresh(); };
  $('agX').onclick = () => d.close();
  if (ed) {
    $('agBack').onclick = () => agentsOpen();
    $('agSave').onclick = async () => {
      const name = $('agName').value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(name) || name.toLowerCase() === 'team') return toast('Agents', 'Use a name of letters, digits, - or _ (starting with a letter), and not "team".');
      if (list.some(a => a.name.toLowerCase() === name.toLowerCase() && a.name !== editName)) return toast('Agents', 'There is already an agent called @' + name + '.');
      const a = { name, model: $('agModel').value, instructions: $('agInstr').value.trim(), tools: $('agTools').checked, memory: $('agMem').value.trim() };
      if (!a.model) return toast('Agents', 'Pick a model.');
      await save(list.filter(x => x.name !== editName).concat(a).slice(0, 30));
      agentsOpen();
    };
  } else {
    const n = prefs.max_agents, cap = $('agCap');
    cap.value = n === null || n === undefined ? 'auto' : n === 0 ? 'off' : String(n);
    if (cap.selectedIndex < 0) cap.value = 'auto';
    api().agents_info().then(r => { $('agCapInfo').textContent = agentsCapText(r); }).catch(() => {});
    cap.onchange = async () => { const r = await agentsSet(cap.value, true); if (r) $('agCapInfo').textContent = agentsCapText(r); };
    $('agNew').onclick = () => agentsOpen('');
    d.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => agentsOpen(b.dataset.ed));
    d.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await save(list.filter(a => a.name !== b.dataset.rm)); agentsOpen(); });
    // share codes carry the name, model and instructions only - never the memory, and an imported agent never gets tools until you allow it
    d.querySelectorAll('[data-share]').forEach(b => b.onclick = () => {
      const a = list.find(x => x.name === b.dataset.share); if (!a) return;
      const code = 'AUORIS-AGENT:' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, name: a.name, model: a.model, instructions: a.instructions }))));
      copyText(code).then(() => toast('Agents', 'Share code copied - your agent\'s memory isn\'t included.'), () => toast('Agents', code));
    });
    $('agImport').onclick = async () => {
      let a = null;
      try { const v = $('agCode').value.trim(); if (!v.startsWith('AUORIS-AGENT:')) throw 0; a = JSON.parse(decodeURIComponent(escape(atob(v.slice(13))))); } catch (e) {}
      if (!a || typeof a.name !== 'string' || typeof a.model !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(a.name)) return toast('Agents', 'That isn\'t a valid agent code.');
      let name = a.name; while (list.some(x => x.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === 'team') name = (name + '2').slice(0, 24);
      const ok = await ask({ title: 'Import @' + name + '?', ok: 'Import', html: `Model: <b>${esc(modelLabel(a.model))}</b><br><br>Instructions it comes with:<div class="bubble" style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px">${esc(String(a.instructions || '(none)').slice(0, 4000))}</div><br>Only import agents from people you trust. It starts without tool access.` });
      if (!ok) return;
      await save(list.concat({ name, model: a.model.slice(0, 200), instructions: String(a.instructions || '').slice(0, 4000), tools: false, memory: '' }).slice(0, 30));
      agentsOpen();
    };
  }
  if (!d.open) d.showModal();
}
// /agents N: how many sub-agents the AI may run at once (the max_agents setting; null = auto). app.py agent_cap() applies it.
function agentsCapWord() { const n = prefs.max_agents; return n === null || n === undefined ? 'auto' : n === 0 ? 'off' : String(n); }
function agentsCapText(r) {
  if (r.setting === null) return `Auto: up to ${r.cap} at once right now (4, or ${r.max} in Vibing effort on a cloud model).`;
  if (r.setting === 0) return 'Off: the AI does the work itself and starts no sub-agents.';
  return `Up to ${r.cap} at once` + (r.cap < r.setting ? ` with the model you have now (a local model allows ${r.local_max}: they all share one GPU)` : '') +
    '. More agents finish big jobs sooner but use more of your cloud budget or AI plan; the daily budget in /usage still applies to every one.';
}
async function agentsSet(v, quietToast) {
  v = String(v).trim().toLowerCase();
  const n = v === 'auto' ? null : v === 'off' ? 0 : /^\d+$/.test(v) ? Math.min(+v, 27) : NaN;
  if (Number.isNaN(n)) { toast('Sub-agents', 'Use /agents 0-27, /agents auto or /agents off. /agents on its own opens your saved @agents.'); return null; }
  prefs.max_agents = n; await api().set_setting('max_agents', n);
  const r = await api().agents_info();
  if (!quietToast) toast('Sub-agents', agentsCapText(r));
  return r;
}
setTimeout(agentsRefresh, 2000);
function agentsChanged() { agentsRefresh(); }
$('usageDlg').onclick = e => { if (outside($('usageDlg'), e)) $('usageDlg').close(); };

// ---- styled confirm dialog (replaces the browser's confirm())
function ask({ title, html, ok = 'OK', danger = false, icon }) {
  const d = $('confirmDlg');
  $('cTitle').textContent = title; $('cMsg').innerHTML = html || '';
  $('cIcon').textContent = icon || (danger ? '🗑' : '?');
  d.classList.toggle('safe', !danger);
  const okBtn = $('cOk'); okBtn.textContent = ok; okBtn.className = danger ? 'dangerbtn' : 'primary';
  return new Promise(resolve => {
    const done = v => { d.close(); okBtn.onclick = $('cCancel').onclick = d.oncancel = null; resolve(v); };
    okBtn.onclick = () => done(true);
    $('cCancel').onclick = () => done(false);
    d.oncancel = e => { e.preventDefault(); done(false); };  // Esc
    d.onclick = e => { if (outside(d, e)) done(false); };   // click outside
    d.showModal(); okBtn.focus();
  });
}

function setStatus(text, state) { $('status').textContent = text; $('status').title = text; $('dot').className = 'dot ' + (state || ''); }
function setCwd(p) { $('cwd').textContent = p; $('cwdBtn').title = p + ' (click to change)'; }
var permNow = 'ask';   // the permission mode in force (choosePerm puts it back when a risky switch is cancelled)
function setPerm(v) { $('permSel').value = v; $('permSel').className = v; permNow = v; }
function showError(t) { clearEmpty(); const d = document.createElement('div'); d.className = 'errbox'; d.textContent = t; log.appendChild(d); scroll(true); }

// Streamed tokens are drawn at most once per frame: each chunk arrives through a blocking evaluate_js, and re-rendering the whole
// reply's markdown per token made long replies slow down both the window and the stream itself.
let curRaf = 0;
function curDraw() { curRaf = 0; if (cur) { const stick = nearBottom(); renderCur(); scroll(stick); } }
function curFlush() { if (curRaf) { cancelAnimationFrame(curRaf); curDraw(); } }
function assistantStart() {
  curFlush(); clearEmpty(); removeTurnBar();
  const m = document.createElement('div'); m.className = 'msg assistant';
  m.innerHTML = '<details class="think" style="display:none"><summary>Thinking</summary><div></div></details><div class="bubble"></div>';
  m.querySelector('summary').onclick = () => { m.querySelector('.think').dataset.touched = 1; };
  log.appendChild(m);
  cur = { el: m, text: '', think: '' };
  scroll();
}
function assistantDiscard() { cancelAnimationFrame(curRaf); curRaf = 0; if (cur) cur.el.remove(); cur = null; }
function renderCur() {
  const [pthink, text] = splitThink(cur.text);
  const think = (cur.think + (pthink ? '\n' + pthink : '')).trim();
  const d = cur.el.querySelector('.think');
  if (think) {
    d.style.display = '';
    const box = d.querySelector('div'); box.textContent = think; box.scrollTop = box.scrollHeight;
    d.querySelector('summary').textContent = text.trim() ? 'Thought process' : 'Thinking...';
    d.querySelector('summary').classList.toggle('live', !text.trim());
    if (!d.dataset.touched) d.open = !text.trim();
  }
  cur.el.querySelector('.bubble').innerHTML = md(text);
}
function gotToken(kind, n) {
  activity(); genTok += n || 1; if (!firstTok) firstTok = Date.now();
  if (kind === 'think' || (cur && /<think>(?![\s\S]*<\/think>)/.test(cur.text))) phaseText = 'Thinking';
  else phaseText = 'Writing reply';
}
function thinkingChunk(t, n) { if (!cur) assistantStart(); cur.think += t; gotToken('think', n); if (!curRaf) curRaf = requestAnimationFrame(curDraw); }
function contentChunk(t, n) { if (!cur) assistantStart(); cur.text += t; gotToken('text', n); if (!curRaf) curRaf = requestAnimationFrame(curDraw); }
function phase(kind, est) {
  phaseStart = Date.now(); genTok = 0; firstTok = 0;
  if (kind === 'reading') phaseText = `Reading the conversation (~${fk(est)} tokens)`;
}
function assistantEnd(cut, stats) {
  curFlush();
  if (cur) {
    const [pthink, text] = splitThink(cur.text);
    if (!text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() && !cur.think.trim() && !pthink) cur.el.remove();
    else {
      if (cur.el.querySelector('.think').style.display !== 'none') {
        cur.el.querySelector('summary').textContent = 'Thought process';
        cur.el.querySelector('summary').classList.remove('live');
        if (!cur.el.querySelector('.think').dataset.touched) cur.el.querySelector('.think').open = false;
      }
      addMeta(cur.el, stats);
      xAddSpeak(cur.el, text); xLastAsst = cur.el;
      linkFiles(cur.el);
    }
  }
  cur = null;
  phaseText = 'Working'; genTok = 0; firstTok = 0;
}
// ---- token formatting / per-reply stats
function money(v) { v = +v || 0; return v === 0 ? '$0' : v < 0.01 ? '<$0.01' : '$' + v.toFixed(v < 10 ? 2 : 0); }
function fk(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n); }
function addMeta(el, s) {
  if (!s || !el) return;
  const m = document.createElement('div'); m.className = 'meta';
  const approx = s.exact ? '' : '~';
  m.innerHTML = `<span title="Tokens the model generated">↑ ${approx}${fk(s.out)} out</span><span title="Tokens it read (conversation + files)">↓ ${approx}${fk(s.in)} in</span>` +
    (s.tps ? `<span title="Generation speed">${s.tps} tok/s</span>` : '') + `<span>${s.secs}s</span>` +
    (typeof s.cost === 'number' ? `<span title="Estimated cost of this reply (cloud API)">${money(s.cost)}</span>` : '');
  el.appendChild(m);
}
// A compaction marker: the older part of the chat was replaced by a summary (Api.compact_chat / autocompact). Click to read the summary.
function compactCard(i) {
  clearEmpty();
  const d = document.createElement('details'); d.className = 'compactcard';
  const sz = i.before ? ` · about ${fk(i.before)} → ${fk(i.after)} tokens` : '';
  d.innerHTML = `<summary>✂ Conversation compacted${i.auto ? ' automatically' : ''}${i.removed ? ` · ${i.removed} older messages summarised` : ''}${sz}</summary><div class="bubble">${md(String(i.summary || ''))}</div>`;
  log.appendChild(d); scroll();
}
function compacted(i) { compactCard(i); toast(i.auto ? 'Autocompact' : 'Compacted', `The older part of this chat is now a summary (${fk(i.before)} → ${fk(i.after)} tokens). The messages above stay on screen until you reopen the chat.`); }
// ---- context meter (top bar)
function ctxUsage(used, active, max) {
  const el = $('ctxMeter'); el.style.display = '';
  const pct = Math.min(100, used / active * 100);
  el.querySelector('i').style.width = Math.max(2, pct * 0.46) + 'px';
  el.querySelector('i').className = pct > 85 ? 'hot' : pct > 60 ? 'warm' : '';
  el.querySelector('span').textContent = `${fk(used)} / ${fk(active)}`;
  el.title = `Context: ${used.toLocaleString()} tokens used of ${active.toLocaleString()} loaded` +
    (active < max ? `\nAuto context grows up to ${max.toLocaleString()} as the chat gets longer (saves VRAM)` : '');
}
// "How this answer was made": the record a multi-model run (/extra, /team, /split, /debate, @agent) leaves on its final reply
function extraPanelHtml(x) {
  if (!x || !Array.isArray(x.steps)) return '';
  const a = x.agreement, v = x.verdict;
  const pills = [];
  if (a) pills.push(`<span class="xpill ${a.score >= 8 ? 'ok' : a.score >= 5 ? 'mid' : 'bad'}" title="${esc(a.point ? 'Main disagreement: ' + a.point : 'Average of the reviewers\' agreement scores')}">${a.score >= 8 ? 'Models agreed' : a.score >= 5 ? 'Partly agreed' : 'Models disagreed'} · ${a.score}/10</span>`);
  if (v) pills.push(`<span class="xpill ${v.approved ? 'ok' : 'mid'}">${v.approved ? 'Reviewer approved' : v.unreviewed ? 'Not reviewed (the reviewer didn\'t answer)' : 'Not approved'} · ${v.rounds} round${v.rounds === 1 ? '' : 's'}</span>`);
  if (typeof x.cost === 'number' && x.cost > 0) pills.push(`<span class="xpill" title="Estimated cloud cost of this whole run">${money(x.cost)}</span>`);
  if (x.secs) pills.push(`<span class="xpill">${x.secs}s</span>`);
  if (x.effort) pills.push(`<span class="xpill" title="Effort for this run">effort: ${esc(x.effort)}</span>`);
  if (x.auto) pills.unshift('<span class="xpill" title="Auto mode picked this for your message (Usage → Multi-model)">Auto</span>');
  if (x.saved) pills.push(`<span class="xpill ok" title="Estimated saving from cheaper reviews">saved ~${money(x.saved)}</span>`);
  const steps = x.steps.filter(s => s.items && s.items.length).map(s => `<div class="xstep"><h5>${esc(s.title)}</h5>${s.items.map(i =>
    `<details class="xpitem"><summary><b>${esc(i.who || '')}</b>${i.role ? `<small>${esc(i.role)}</small>` : ''}</summary><div class="bubble">${md(i.text || '')}</div></details>`).join('')}</div>`).join('');
  return `<details class="xpanel"><summary>🧩 <b>How this answer was made</b> · ${esc(x.label || '')} · ${(x.models || []).map(esc).join(', ')} ${pills.join(' ')}</summary>
    <div class="xsteps">${steps || '<span class="vsub">No intermediate steps.</span>'}${a && a.point ? `<div class="vsub">Main disagreement: ${esc(a.point)}</div>` : ''}</div>
    ${x.steps.some(s => ['Drafts', 'Team roles', 'Revised answers'].includes(s.title) && s.items && s.items.length >= 2) ? `<div class="xacts">
      <button class="btn sm" data-xagain="recheck" title="New reviews of these same drafts, then a new answer - no new drafts are paid for">🔁 Cross-check again</button>
      ${a && (a.point || a.score < 8) ? '<button class="btn sm" data-xagain="explain" title="Why the models disagreed, and who is right">🔍 Explain the disagreement</button>' : ''}</div>` : ''}</details>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-xagain]'); if (!b) return;
  const el = b.closest('.msg.assistant'), x = el && el._xinfo; if (!x) return;
  api().extra_again(b.dataset.xagain, x);
});
function addExtraPanel(el, x) {
  if (!el || !x) return;
  const old = el.querySelector('.xpanel'); if (old) old.remove();
  el._xinfo = x;
  el.insertAdjacentHTML('beforeend', extraPanelHtml(x));
}
function extraPanel(x) { multiEnd(); addExtraPanel([...log.querySelectorAll('.msg.assistant')].pop(), x); scroll(); }
// live progress while a multi-model run works: one row per model per stage; a working cloud model can be skipped
let xLive = null;
function multiStart(label) {
  multiEnd();
  xLive = document.createElement('div'); xLive.className = 'xlive';
  xLive.innerHTML = `<b>🧩 ${esc(label)}</b>`;
  log.appendChild(xLive); scroll();
}
function multiStage(stage, models) {
  if (!xLive) multiStart('Working');
  const h = document.createElement('h5'); h.textContent = stage; xLive.appendChild(h);
  for (const m of models || []) {
    const row = document.createElement('div'); row.className = 'xl'; row.dataset.stage = stage; row.dataset.model = m.id;
    row.innerHTML = `<i></i><span><b>${esc(m.name)}</b> <small>${m.writing ? 'writing the answer…' : 'working…'}</small></span>` +
      (!m.writing ? '<button class="btn sm" title="Stop this model and carry on without it">Stop</button>' : '');
    const b = row.querySelector('button');
    if (b) b.onclick = () => { b.disabled = true; b.textContent = 'Stopping…'; api().multi_skip(m.id); };
    xLive.appendChild(row);
  }
  log.appendChild(xLive); scroll();
}
function multiItem(stage, model, text, err) {
  if (!xLive) return;
  const row = [...xLive.querySelectorAll('.xl')].find(r => r.dataset.stage === stage && r.dataset.model === model); if (!row) return;
  const name = row.querySelector('b').textContent; row.querySelector('button')?.remove();
  row.classList.add(text ? 'done' : 'fail');
  row.querySelector('span').innerHTML = text ? `<details><summary><b>${esc(name)}</b> <small>done · ${fk(Math.round(text.length / 3.3))} tokens</small></summary><div class="bubble">${md(text)}</div></details>`
    : `<b>${esc(name)}</b> <small>${esc(err === 'skipped' ? 'skipped' : 'no answer' + (err ? ': ' + err : ''))}</small>`;
}
function multiEnd() { if (xLive) xLive.remove(); xLive = null; }
function renderAssistant(content, thinking, stats, extra) {
  assistantStart(); cur.think = thinking || ''; cur.text = content || ''; renderCur();
  const d = cur.el.querySelector('.think'); d.open = false; d.querySelector('summary').textContent = 'Thought process';
  addMeta(cur.el, stats);
  if (extra) addExtraPanel(cur.el, extra);
  xAddSpeak(cur.el, splitThink(cur.text)[1]);
  cur = null;
}

function summarize(name, a) {
  if (name === 'ask_model') return (a.model || '') + (a.kind === 'image' ? ' (image)' : '') + ': ' + String(a.prompt || '').slice(0, 90);
  if (name === 'run_command') return a.command;
  if (name === 'spawn_agent') return (a.name || 'sub-agent') + (a.model ? ' · ' + a.model : '') + (a.agent ? ' · @' + a.agent : '') + ': ' + String(a.task || '').slice(0, 90);
  if (name === 'wait_agents') return a.ids && a.ids.length ? a.ids.length + ' sub-agent' + (a.ids.length === 1 ? '' : 's') : 'all sub-agents';
  if (name === 'stop_process') return 'background job ' + a.job;
  if (name === 'open_in_browser') return a.target;
  if (name === 'fetch_url') return a.url;
  if (a.path) return a.path + (a.contains ? `  "${a.contains}"` : '');
  return JSON.stringify(a);
}
function toolStart(id, name, args, absPath) {
  clearEmpty(); removeTurnBar(); activity();
  args = args || {};
  const verb = { list_directory: 'Looking in', read_file: 'Reading', write_file: 'Writing', edit_file: 'Editing',
                 search_files: 'Searching', run_command: 'Running', change_directory: 'Moving to', spawn_agent: 'Starting sub-agent', wait_agents: 'Waiting for', fetch_url: 'Reading' }[name] || name;
  const what = String(summarize(name, args)); phaseText = `${verb} ${what.length > 60 ? '…' + what.slice(-58) : what}`;
  genTok = 0; firstTok = 0;
  const t = document.createElement('div'); t.className = 'tool';
  const argText = name === 'write_file' ? `${args.path}\n\n${args.content}`
             : name === 'edit_file' ? `${args.path}\n\n--- old ---\n${args.old_text}\n--- new ---\n${args.new_text}`
             : name === 'run_command' ? `${args.command}${args.cwd ? '\n(cwd: ' + args.cwd + ')' : ''}`
             : JSON.stringify(args, null, 2);
  t.innerHTML = `<div class="head"><span class="ico">${TOOL_ICON[name] || (/^mcp__/.test(name) ? '🔌' : '•')}</span><span class="name">${esc(TOOL_LABEL[name] || prettyTool(name))}</span><span class="summary${absPath ? ' fileref' : ''}"${absPath ? ` data-path="${esc(absPath)}"` : ''}>${esc(summarize(name, args))}</span><span class="state">running</span></div>
    <div class="body"><pre class="args">${esc(argText)}</pre><pre class="out" style="display:none"></pre></div>`;
  t.querySelector('.head').onclick = () => t.classList.toggle('open');
  log.appendChild(t);
  tools[id] = t;
  scroll();
}
// ---- ask_model side panel: the prompt another model was given and its answer, live
const DLG = {};
function delegateStart(id, label, prompt, kind) {
  $('dlgPane').hidden = false; document.body.classList.add('dlgOpen');
  const el = document.createElement('div'); el.className = 'dlgItem running';
  el.innerHTML = `<div class="dlgTop"><span class="dlgModel"></span><span class="dlgState">working…</span></div>
    <details class="dlgPrompt" open><summary>Prompt${kind === 'image' ? ' (picture)' : ''}</summary><div class="dlgText"></div></details>
    <div class="dlgResp"></div><div class="dlgImgs"></div>`;
  el.querySelector('.dlgModel').textContent = label; el.querySelector('.dlgText').textContent = prompt;
  $('dlgList').appendChild(el); DLG[id] = { el, text: '' };
  el.scrollIntoView({ block: 'end' });
}
function delegateChunk(id, t) {
  const d = DLG[id]; if (!d) return;
  d.text += t; const r = d.el.querySelector('.dlgResp'); r.textContent = d.text;
  const box = $('dlgList'); box.scrollTop = box.scrollHeight;
}
function delegateDone(id, text, imgs, ok) {
  const d = DLG[id]; if (!d) return;
  d.el.classList.remove('running'); d.el.classList.toggle('failed', !ok);
  d.el.querySelector('.dlgState').textContent = ok ? 'done' : 'failed';
  d.el.querySelector('.dlgPrompt').open = false;
  const r = d.el.querySelector('.dlgResp');
  if (text) r.innerHTML = md(text); else r.textContent = '';
  const box = d.el.querySelector('.dlgImgs');
  for (const u of imgs || []) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u)) continue;
    const im = new Image(); im.src = u; im.title = 'Click to enlarge'; im.onclick = () => im.classList.toggle('big'); box.appendChild(im);
  }
}
$('dlgClose').onclick = () => { $('dlgPane').hidden = true; document.body.classList.remove('dlgOpen'); $('dlgList').innerHTML = ''; };
function toolAuto(id, reason) {
  const t = tools[id]; if (!t) return;
  const b = document.createElement('span'); b.className = 'auto'; b.textContent = 'auto'; b.title = reason;
  t.querySelector('.state').before(b);
}
function askApproval(id, name, reason) {
  const t = tools[id]; t.classList.add('open');
  t.querySelector('.state').textContent = 'needs approval';
  const bar = document.createElement('div'); bar.className = 'approve';
  const alwaysLabel = name === 'run_command' ? 'Always allow everything' : 'Always allow edits';
  const why = reason ? `<span class="why"><b>⚠ Caught:</b> ${esc(reason)}</span>` : '';
  bar.innerHTML = `${why}<span>Allow this ${name === 'run_command' ? 'command' : 'file change'}?</span><button class="primary">Allow</button><button class="btn">${alwaysLabel}</button><button class="btn">Deny</button>`;
  const [yes, always, no] = bar.querySelectorAll('button');
  waitingApproval++; tickWorking();
  const done = (ok, alw) => { waitingApproval = Math.max(0, waitingApproval - 1); activity(); bar.remove(); t.querySelector('.state').textContent = ok ? 'running' : 'denied'; api().approve(id, ok, alw ? name : false); };
  yes.onclick = () => done(true); always.onclick = () => done(true, true); no.onclick = () => done(false);
  t.appendChild(bar);
  scroll(true);
}
function cmdStart(cmd, cwd) {
  const ids = Object.keys(tools); const t = tools[ids[ids.length - 1]];
  if (!t) return;
  t.classList.add('open');
  cmdPre = t.querySelector('.out'); cmdPre.style.display = ''; cmdPre.textContent = '';
  if (!t.querySelector('.cmdstop')) {
    const b = document.createElement('button'); b.className = 'linkb cmdstop'; b.textContent = '■ stop command'; b.title = 'Stop just this command (the AI keeps going)';
    b.onclick = e => { e.stopPropagation(); b.disabled = true; b.textContent = 'stopping…'; api().kill_command(); };
    t.querySelector('.state').before(b);
  }
}
// ---- background commands (servers): Open + Stop server on the step
const bgCards = {};
function bgStarted(job, cmd, url) {
  const ids = Object.keys(tools); const t = tools[ids[ids.length - 1]]; if (!t) return;
  t.querySelector('.cmdstop')?.remove();
  t.classList.add('bg'); t.dataset.job = job; bgCards[job] = t;
  const bar = document.createElement('div'); bar.className = 'bgbar';
  bar.innerHTML = `<span class="bglive"><i></i>Running in the background · job ${esc(job)}</span>` +
    (url ? `<a class="xlink bgurl" href="${esc(url)}">${esc(url)}</a><button class="primary sm bgopen">Open</button>` : '') + '<button class="btn sm bgstop">Stop server</button>';
  bar.querySelector('.bgopen')?.addEventListener('click', e => { e.stopPropagation(); openLink(url); });
  bar.querySelector('.bgurl')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openLink(url); });
  bar.querySelector('.bgstop').onclick = async e => { e.stopPropagation(); e.target.disabled = true; await api().bg_stop(job); };
  t.querySelector('.head').after(bar);
}
function bgStopped(job) {
  const t = bgCards[job]; if (!t) return; delete bgCards[job];
  t.classList.remove('bg'); t.classList.add('bgdone');
  const bar = t.querySelector('.bgbar'); if (bar) bar.innerHTML = '<span class="bgoff">■ Stopped</span>';
  const st = t.querySelector('.state'); st.textContent = 'stopped'; st.className = 'state';
}
function cmdOutput(line) {
  activity();
  if (!cmdPre) return;
  const atEnd = cmdPre.scrollHeight - cmdPre.scrollTop - cmdPre.clientHeight < 30;
  cmdPre.textContent += line;
  if (atEnd) cmdPre.scrollTop = cmdPre.scrollHeight;
  scroll();
}
function setToolState(t, status, result) {
  const st = t.querySelector('.state');
  t.querySelector('.cmdstop')?.remove();
  if (t.classList.contains('bg') && status === 'done') status = 'running';
  st.textContent = status; st.className = 'state ' + (status === 'done' || status === 'running' ? 'done' : 'bad');
  const out = t.querySelector('.out'); out.style.display = ''; out.textContent = result;
}
function toolEnd(id, result, ok) {
  const t = tools[id]; if (!t) return;
  activity();
  const failed = !ok || /^Error:|^exit code: (?!0$)/m.test(result);
  setToolState(t, !ok ? 'denied' : failed ? 'failed' : 'done', result);
  if (t.querySelector('.ico').textContent !== '›_' || !failed) t.classList.remove('open');
  cmdPre = null;
  scroll();
}
function removeTurnBar() { document.querySelectorAll('.turnbar').forEach(e => e.remove()); }
function addTurnBar() {
  removeTurnBar();
  if (!log.querySelector('.msg')) return;
  const b = document.createElement('div'); b.className = 'turnbar';
  b.innerHTML = '<button title="Answer the last message again">↻ Regenerate</button><button title="Copy the last answer">⧉ Copy</button>' +
    (lastTurn && lastTurn.steps ? `<span class="turnstats" title="Totals for this answer (all steps)">${lastTurn.steps} step${lastTurn.steps > 1 ? 's' : ''} · ${fk(lastTurn.out)} tokens out · ${fk(lastTurn.in)} read · ${fmt(lastTurn.secs * 1000)}</span>` : '');
  const [regen, copy] = b.querySelectorAll('button');
  regen.onclick = regenerate;
  copy.onclick = () => {
    const last = [...log.querySelectorAll('.msg.assistant .bubble')].pop();
    if (last) { const c = last.cloneNode(true); const src = [], dst = [];
      for (const [root, arr] of [[last, src], [c, dst]]) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) arr.push(n); }
      src.forEach((n, i) => { if (origText.get(n)) dst[i].nodeValue = origText.get(n); });
      c.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(c); const txt = c.innerText; c.remove();
      copyText(txt).then(() => { copy.textContent = '✓ Copied'; }, () => { copy.textContent = '✗ Copy failed'; toast('Copy failed', 'Select the text and press Ctrl+C instead.'); });
      setTimeout(() => copy.textContent = '⧉ Copy', 1500); }
  };
  log.appendChild(b);
}
function setBusy(b) {
  busy = b; $('stopBtn').style.display = b ? '' : 'none';
  $('stopBtn').disabled = false; $('stopBtn').textContent = '■';
  $('sendBtn').title = b ? 'Queue follow-up (sent when the AI finishes its current step)' : 'Send (Enter)';
  input.placeholder = b ? t('phBusy') : t(mode === 'chat' ? 'phChat' : 'ph');
  turnStart = lastAct = Date.now(); waitingApproval = 0;
  $('working').classList.toggle('on', b);
  if (b) tickWorking();
  renderQueue(queueList);
  if (!b && pendingMode) { setTimeout(() => { if (busy || !pendingMode) return; const m = pendingMode; pendingMode = null; const btn = $('modeSeg').querySelector(`[data-mode="${m}"]`); if (btn) btn.click(); }, 400); }
}

// ---- live "still working" indicator (tool calls like big file writes don't stream any text)
let turnStart = 0, lastAct = 0, waitingApproval = 0;
let phaseText = 'Working', phaseStart = 0, genTok = 0, firstTok = 0, lastTurn = null;
function activity() { lastAct = Date.now(); }
function fmt(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }
function tickWorking() {
  const w = $('working');
  if (!busy || waitingApproval) { w.classList.remove('on'); return; }
  w.classList.add('on');
  const now = Date.now(), idle = now - lastAct;
  const parts = [`<b>${esc(phaseText)}</b>`];
  if (genTok) {
    const secs = (now - firstTok) / 1000;
    parts.push(`${fk(genTok)} tokens`);
    if (secs > 1) parts.push(`${(genTok / secs).toFixed(1)} tok/s`);
  }
  parts.push(fmt(now - turnStart));
  let t = parts.join(' · ');
  if (!cmdPre && !phaseText.startsWith('Running') && idle > 6000 && genTok)
    t += ` · <span class="hintx">no new text for ${fmt(idle)} — probably writing a file or command (shown when done)</span>`;
  else if (!cmdPre && phaseText.startsWith('Reading the conv') && now - phaseStart > 8000)
    t += ` · <span class="hintx">long chats take a while to read in; a file/command may also be being written</span>`;
  $('workText').innerHTML = t;
  scroll();
}
setInterval(tickWorking, 1000);
function turnStarted() { if (!busy) setBusy(true); xLastAsst = null; }
function turnDone(stopped, ts) {
  if (stopped) multiEnd();
  setBusy(false); lastTurn = ts; addTurnBar(); paused = stopped; renderQueue(queueList); input.focus();
  if (!stopped) {
    if (!document.hasFocus()) Sfx.play('done'); // useful: an AI reply finished while you were in another window
    const last = [...log.querySelectorAll('.msg.assistant .bubble')].pop();
    if (last) firePluginChatEvent('assistant', realText(last));
    if (prefs.tts_auto && !call.on && xLastAsst && xLastAsst.isConnected) xSpeak(xLastAsst, xLastAsst._xraw);
  }
  if (call.on && call.pending) { const w = call.pending; call.pending = null; w.resolve(stopped ? '' : ((xLastAsst && xLastAsst._xraw) || '')); }
}
function approvalClosed(id) {
  const t = tools[id]; if (!t) return;
  const bar = t.querySelector('.approve');
  if (bar) { bar.remove(); waitingApproval = Math.max(0, waitingApproval - 1); }
}

// ---- follow-up queue
let queueList = [], paused = false, editingId = null;
function queueChanged(list) { renderQueue(list); }
function renderQueue(list) {
  queueList = list || [];
  const box = $('queue');
  // keep existing bubbles (no re-animation) and only rebuild what changed
  const want = new Set(queueList.map(q => q.id));
  if (editingId && !want.has(editingId)) editingId = null;
  [...box.children].forEach(el => { if (!want.has(el.dataset.id)) el.remove(); });
  const label = busy ? 'Queued · sends after the current step' : (paused ? 'Queued · paused (you pressed Stop)' : 'Queued');
  queueList.forEach((q, idx) => {
    let el = box.querySelector(`[data-id="${q.id}"]`);
    const key = (editingId === q.id ? 'E' : 'V') + q.text + label;
    if (el && el.dataset.key === key) { if (box.children[idx] !== el) box.insertBefore(el, box.children[idx]); return; }
    const fresh = document.createElement('div'); fresh.className = 'qi'; fresh.dataset.id = q.id; fresh.dataset.key = key;
    if (el) { fresh.style.animation = 'none'; el.replaceWith(fresh); } else box.insertBefore(fresh, box.children[idx] || null);
    el = fresh;
    const atts = q.atts && q.atts.length ? `<div class="atts">${q.atts.map(a => `<span class="chip">${attThumb(a)} <span>${esc(a.name)}</span></span>`).join('')}</div>` : '';
    if (editingId === q.id) {
      el.classList.add('editing');
      el.innerHTML = `<textarea rows="2"></textarea><div class="qm"><button class="now">Save</button><button>Cancel</button></div>`;
      const ta = el.querySelector('textarea'); ta.value = q.text;
      const [save, cancel] = el.querySelectorAll('button');
      const doSave = async () => { editingId = null; renderQueue(await api().edit_queued(q.id, ta.value.trim() || q.text)); };
      save.onclick = doSave;
      cancel.onclick = () => { editingId = null; renderQueue(queueList); };
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); } if (e.key === 'Escape') { e.stopPropagation(); cancel.onclick(); } };
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    } else {
      el.innerHTML = `${atts}<div class="qb"></div><div class="qm"><span class="qtag">${label}</span>` +
        `<button class="now" title="Interrupt and send this now">Send now</button><button title="Edit">Edit</button><button title="Remove">✕</button></div>`;
      el.querySelector('.qb').textContent = q.text;
      const [now, edit, del] = el.querySelectorAll('button');
      now.onclick = async () => { paused = false; renderQueue(await api().send_now(q.id)); };
      edit.onclick = () => { editingId = q.id; renderQueue(queueList); };
      del.onclick = async () => renderQueue(await api().cancel_queued(q.id));
    }
  });
  scroll();
}

// ---- history rendering
function attIcon(k) { return k === 'image' ? '🖼' : k === 'folder' ? '📁' : '📄'; }
// picture attachments show a thumbnail instead of the icon; the pixels come from the local file through the app
const thumbCache = new Map();
function attThumb(a) { return a && a.kind === 'image' && a.path ? `<img class="athumb" data-tp="${esc(a.path)}" alt="">` : attIcon(a && a.kind); }
function hydrateThumbs(root) {
  (root || document).querySelectorAll('img.athumb[data-tp]:not([src])').forEach(async img => {
    const p = img.dataset.tp;
    if (!thumbCache.has(p)) {
      thumbCache.set(p, api().image_preview(p).catch(() => null));
      if (thumbCache.size > 24) thumbCache.delete(thumbCache.keys().next().value);   // only the most recent pictures stay in memory
    }
    const src = await thumbCache.get(p);
    if (src) img.src = src; else { thumbCache.delete(p); img.replaceWith(document.createTextNode(attIcon('image'))); }
  });
}
function userMsg(text, atts) {
  clearEmpty(); removeTurnBar();
  const m = document.createElement('div'); m.className = 'msg user';
  const a = (atts && atts.length) ? `<div class="atts">${atts.map(x => `<span class="chip" title="${esc(x.path || '')}">${attThumb(x)} <span>${esc(x.name)}</span></span>`).join('')}</div>` : '';
  m.innerHTML = a + (text ? `<div class="uline"><div class="bubble">${esc(text)}</div><span class="avatar me"></span></div>` : '');
  const av = m.querySelector('.avatar'); if (av) paintAvatar(av);
  log.appendChild(m); hydrateThumbs(m);
}
function renderHistory(events) {
  log.innerHTML = '';
  for (const k in tools) delete tools[k];
  if (!events || !events.length) { showEmpty(); return; }
  events.forEach((e, i) => {
    if (e.type === 'user') userMsg(e.text, e.atts);
    else if (e.type === 'compact') compactCard({ summary: e.text, removed: e.removed });
    else if (e.type === 'assistant') renderAssistant(e.content, e.thinking, e.stats, e.extra);
    else if (e.type === 'tool') {
      const id = 'h' + i; toolStart(id, e.name, e.args, e.abs); setToolState(tools[id], e.status, e.result);
    }
  });
  addTurnBar();
  linkFiles();
  scroll(true);
}

// ---- sidebar
function groupOf(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const day = 864e5, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d >= start) return t('today');
  if (d >= start - day) return t('yesterday');
  if (d >= start - 7 * day) return t('week');
  if (d >= start - 30 * day) return t('month');
  return t('older');
}
async function refreshChats() { allChats = await api().list_chats(); drawChats(); }
function drawChats() {
  const q = $('search').value.toLowerCase();
  const box = $('chats'); box.innerHTML = '';
  let last = null;
  const all = allChats.filter(c => (c.mode || 'code') === mode && (!q || c.title.toLowerCase().includes(q)));
  const list = all.filter(c => !c.group);
  if (!all.length) box.innerHTML = `<div class="chempty">${esc(q ? t('noMatch') : t('noChats'))}</div>`;
  const groups = {};
  for (const c of all) if (c.group) (groups[c.group] = groups[c.group] || []).push(c);
  let openG = {}; try { openG = JSON.parse(localStorage.getItem('chatFoldersOpen') || '{}'); } catch (e) {}
  for (const name of Object.keys(groups).sort()) {
    const open = !!q || !!openG[name];
    const h = document.createElement('div'); h.className = 'grp chfold' + (open ? ' open' : '');
    h.textContent = (open ? '▾ ' : '▸ ') + '📁 ' + name + ' (' + groups[name].length + ')'; h.title = 'Chats imported from ' + name;
    h.onclick = () => { openG[name] = !openG[name]; try { localStorage.setItem('chatFoldersOpen', JSON.stringify(openG)); } catch (e) {} drawChats(); };
    box.appendChild(h);
    if (open) for (const c of groups[name]) box.appendChild(chatRow(c, true));
  }
  for (const c of list) {
    const g = groupOf(c.updated);
    if (g !== last) { const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; h.style.setProperty('--i', box.children.length); box.appendChild(h); last = g; }
    box.appendChild(chatRow(c));
  }
}
function chatRow(c, inFolder) {
  {
    const el = document.createElement('div'); el.className = 'ci' + (c.id === chatId ? ' active' : '') + (inFolder ? ' infold' : '');
    el.style.setProperty('--i', $('chats').children.length);
    el.innerHTML = `<span class="t" title="${esc(c.title)}">${esc(c.title)}</span><span class="acts"><b title="Export this chat">⤓</b><b title="Rename">✎</b><b title="Delete">✕</b></span>`;
    const [exp, ren, del] = el.querySelectorAll('b');
    exp.onclick = ev => { ev.stopPropagation(); xExportDlg(c.id); };
    el.onclick = () => openChat(c.id);
    ren.onclick = ev => { ev.stopPropagation(); startRename(el, c); };
    del.onclick = async ev => {
      ev.stopPropagation();
      if (!await ask({ title: 'Delete chat?', html: `<b>${esc(c.title)}</b> will be permanently deleted.`, ok: 'Delete', danger: true })) return;
      const newId = await api().delete_chat(c.id);
      if (newId === false) return;
      if (c.id === chatId) { chatId = newId; showEmpty(); renderAtts([]); xRefreshExt(); }
      refreshChats();
    };
    return el;
  }
}
async function importChatsDlg() {
  const r = await api().import_scan();
  const src = r.sources || {}, names = Object.keys(src);
  const pages = r.export_pages || {};
  const missing = Object.keys(pages).filter(n => !src[n]);
  const rows = names.map(n => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" data-app="${esc(n)}" ${src[n].new ? 'checked' : 'disabled'}>
      <b>${esc(n)}</b><span class="muted small">${src[n].found} chats${src[n].new ? ', ' + src[n].new + ' new' : ', all already imported'}</span></label>`).join('');
  const help = missing.length ? `<div class="muted small" style="margin-top:10px">${missing.map(n => `<b>${esc(n)}</b>`).join(' and ')} keep${missing.length > 1 ? '' : 's'} chats online, not on your PC.
      Request your data export (${missing.map(n => `<a href="#" data-page="${esc(n)}">${esc(n)} export</a>`).join(', ')}); when the zip lands in Downloads, run /import again.</div>` : '';
  const pr = ask({ title: 'Import chats from other AI apps', icon: '⇩', ok: names.length ? 'Import' : 'OK',
    html: (names.length ? `<div class="muted small">Found on this PC. Each app gets its own folder in the sidebar; nothing is changed or uploaded.</div>${rows}` : '<div class="muted small">No chats from other AI apps found on this PC yet.</div>') + help + (r.error ? `<div class="muted small">${esc(r.error)}</div>` : '') });
  $('cMsg').querySelectorAll('a[data-page]').forEach(a => a.onclick = e => { e.preventDefault(); openLink(pages[a.dataset.page]); });
  const go = await pr;
  if (!go || !names.length) return;
  const pick = [...$('cMsg').querySelectorAll('input[data-app]:checked')].map(x => x.dataset.app);
  if (!pick.length) return;
  const res = await api().import_run(pick);
  if (res.error) return toast('Import failed', res.error);
  const done = res.done || {}, n = Object.values(done).reduce((a, b) => a + b, 0);
  toast('Imported ' + n + ' chat' + (n === 1 ? '' : 's'), Object.entries(done).map(([k, v]) => k + ': ' + v).join(', ') || 'Nothing new');
  refreshChats();
}
function startRename(el, c) {
  const t = el.querySelector('.t');
  const inp = document.createElement('input'); inp.value = c.title;
  t.replaceWith(inp); inp.focus(); inp.select();
  inp.onclick = e => e.stopPropagation();
  let done = false;
  const finish = async save => {
    if (done) return; done = true;
    if (save && inp.value.trim()) await api().rename_chat(c.id, inp.value);
    refreshChats();
  };
  inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
}
async function openChat(id) {
  if (busy) { showError('Wait for the current reply to finish (or press Stop) before switching chats.'); return; }
  if (id === chatId) return;
  const events = await api().load_chat(id);
  if (events === null) return;
  const meta = allChats.find(c => c.id === id);
  setModeUI(meta ? meta.mode : 'code'); setIncognitoUI(false);
  chatId = id; renderAtts([]); renderQueue([]);
  xTtsStop(); xRefreshExt();
  renderHistory(events);
  drawChats();
}
function chatsChanged(id) { chatId = id; refreshChats(); }
async function newChat() {
  const id = await api().new_chat(mode, incognito);
  if (id === false) { showError('Wait for the current reply to finish (or press Stop) first.'); return false; }
  chatId = id; showEmpty(); renderAtts([]); renderQueue([]); drawChats(); input.focus(); xTtsStop(); xRefreshExt();
  return true;
}

// ---- attachments
function renderAtts(list) {
  const box = $('atts'); box.innerHTML = '';
  (list || []).forEach((a, i) => {
    const c = document.createElement('span'); c.className = 'chip'; c.title = a.path;
    c.dataset.kind = a.kind; c.dataset.name = a.name; c.dataset.path = a.path;
    c.innerHTML = `${attThumb(a)} <span>${esc(a.name)}</span><b>✕</b>`;
    c.querySelector('b').onclick = async () => renderAtts(await api().remove_attachment(i));
    box.appendChild(c); hydrateThumbs(c);
  });
}
async function addBlobs(files) {
  for (const f of files) {
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(f); });
    renderAtts(await api().add_dropped(f.name || 'pasted.png', b64));
  }
}
// ---- @mention suggestions: type @ and a few letters, a small list of matching people appears above the box; Tab (or a click) picks one.
// getCands() returns profile-like objects ({id, username, display_name, avatar_url}); it is asked again on every keystroke because the
// people in a chat change.
function attachMention(inp, getCands) {
  if (!inp || inp._mention) return;
  inp._mention = true;
  let pop = null, items = [], sel = 0, start = -1;
  const close = () => { if (pop) pop.remove(); pop = null; items = []; };
  const pick = i => {
    const p = items[i]; if (!p) return;
    const pos = inp.selectionStart, ins = '@' + p.username + ' ';
    inp.value = inp.value.slice(0, start) + ins + inp.value.slice(pos);
    const c = start + ins.length; inp.setSelectionRange(c, c);
    close(); inp.focus();
  };
  const draw = () => {
    if (!items.length) return close();
    if (!pop) { pop = document.createElement('div'); pop.className = 'mpop'; document.body.appendChild(pop); }
    const r = inp.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left) + 'px'; pop.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    pop.innerHTML = items.map((p, i) => `<div class="mpi ${i === sel ? 'on' : ''}" data-i="${i}"><span class="mpa" style="${p.avatar_url ? `background-image:${cssUrl(p.avatar_url)}` : `background:${esc(p.color || '#5b9dff')}`}">${p.avatar_url ? '' : esc((p.username || '?')[0].toUpperCase())}</span><b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)}</small></div>`).join('') + '<div class="mph">Tab to pick</div>';
    pop.querySelectorAll('.mpi').forEach(el => el.onmousedown = e => { e.preventDefault(); pick(Number(el.dataset.i)); });
  };
  const update = () => {
    const pos = inp.selectionStart, m = /(^|\s)@([\w.-]{0,20})$/.exec(inp.value.slice(0, pos));
    if (!m) return close();
    start = pos - m[2].length - 1;
    const q = m[2].toLowerCase(), seen = new Set(), list = [];
    for (const p of (getCands() || [])) {
      if (!p || !p.username || seen.has(p.id) || (typeof me !== 'undefined' && me && p.id === me.id)) continue;
      seen.add(p.id);
      const un = p.username.toLowerCase(), dn = String(p.display_name || '').toLowerCase();
      if (!q || un.startsWith(q) || dn.startsWith(q) || un.includes(q)) list.push([un.startsWith(q) || dn.startsWith(q) ? 0 : 1, p]);
    }
    list.sort((a, b) => a[0] - b[0]);
    items = list.slice(0, 6).map(x => x[1]); sel = Math.min(sel, Math.max(0, items.length - 1)); draw();
  };
  inp.addEventListener('input', update);
  inp.addEventListener('click', update);
  inp.addEventListener('blur', () => setTimeout(close, 150));
  inp.addEventListener('keydown', e => {
    if (!pop || !items.length) return;
    if (e.key === 'Tab') { e.preventDefault(); pick(sel); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}
// ---- voice input (speech-to-text dictation) - shared by every composer: the main chat input here, plus
// DMs/group chats/server channels/AI projects in script 2 below (both <script> blocks share one global scope).
// Feature-detected on load: WebView2's embedded Chromium speech-recognition backend has historically been
// unreliable outside a real browser tab, so the mic button only appears where the API object actually exists,
// and a runtime failure (no-speech/not-allowed/network/etc.) shows a one-line toast instead of looking broken.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const VOICE_LANG_MAP = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', it: 'it-IT', ru: 'ru-RU', ja: 'ja-JP', zh: 'zh-CN' };
function voiceLang() { return VOICE_LANG_MAP[typeof LANG !== 'undefined' ? LANG : 'en'] || 'en-US'; }
// attachMic(btn, getEl): getEl is a function returning the <input>/<textarea> to dictate into (a function
// rather than the element itself, because svChatInput/grChatInput/prChatInput are torn down and rebuilt
// every time the user switches channel/chat, so the element instance can change after this is first wired).
// Microphone permission: request it first (so the system prompt appears) and, when it's turned off, make the
// notification itself the fix - clicking it opens the Windows microphone privacy page.
// Auoris's own microphone screen (instead of the browser engine's "wants to use your microphone" bubble). The answer is remembered
// and can be changed in Settings; "Don't allow" means the microphone is never requested for calls or voice input.
let micAsk = null;
function micConsent() {
  if (prefs.mic_access === 'allow') return Promise.resolve(true);
  if (prefs.mic_access === 'deny') {
    toast('Microphone is off', 'Auoris isn\'t allowed to use your microphone. Turn it on in Settings (Let Auoris use my microphone).');
    return Promise.resolve(false);
  }
  if (micAsk) return micAsk;
  micAsk = new Promise(res => {
    const g = document.createElement('div'); g.id = 'micGate'; g.style.cssText = 'position:fixed;inset:0;z-index:9660;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px';
    g.innerHTML = '<div class="legalbox" style="width:min(420px,100%);padding:26px 24px 20px;text-align:center"><div style="font-size:34px;line-height:1">🎙️</div>'
      + '<h2 style="margin:12px 0 8px;font-size:19px">Allow Auoris to use your microphone?</h2>'
      + '<p style="margin:0 0 18px;color:var(--muted);font-size:13.5px;line-height:1.55">It is only used for voice calls and voice input, and only while you use them. You can change this any time in Settings.</p>'
      + '<div style="display:flex;gap:10px;justify-content:center"><button class="btn" id="micNo">Don\'t allow</button><button class="btn primary" id="micYes">Allow</button></div></div>';
    document.body.appendChild(g);
    const done = ok => { g.remove(); micAsk = null; prefs.mic_access = ok ? 'allow' : 'deny'; try { api().set_setting('mic_access', prefs.mic_access); } catch (e) {} try { $('micAccessIn').checked = ok; } catch (e) {} res(ok); };
    g.querySelector('#micYes').onclick = () => done(true);
    g.querySelector('#micNo').onclick = () => done(false);
  });
  return micAsk;
}
$('micAccessIn').onchange = () => { prefs.mic_access = $('micAccessIn').checked ? 'allow' : 'deny'; api().set_setting('mic_access', prefs.mic_access); };
async function micAccess() {
  if (!(await micConsent())) return false;
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) micBlocked();
    else toast('Voice input', e && e.name === 'NotFoundError' ? 'No microphone was found. Plug one in and try again.' : "Couldn't use the microphone - another app may be using it.");
    return false;
  }
}
function micBlocked() {
  toast('Microphone is turned off', 'Click here to open Windows microphone settings. Switch on "Let desktop apps access your microphone", then try again.',
    () => { try { api().open_mic_settings(); } catch (e) {} });
}
// Voice input. The browser engine's SpeechRecognition is tried first; where it can't reach its speech service (a "network" error inside
// the app window, common on Windows) Auoris falls back to Windows' own offline dictation (Api.voice_start) and remembers that choice.
const voiceSinks = {};   // token -> {text(text, final), end()} for the Windows dictation in progress
let voiceTok = 0;
function voiceText(tok, text, final) { const f = voiceSinks[tok]; if (f) f.text(text, final); }
function voiceEnded(tok) { const f = voiceSinks[tok]; if (f) f.end(); }
const voiceNative = () => { try { return localStorage.getItem('auoris_voice') === 'native'; } catch (e) { return false; } };
function attachMic(btn, getEl) {
  if (!btn) return;
  let rec = null, listening = false, starting = false, myTok = 0;
  const stop = () => { listening = false; btn.classList.remove('mic-rec'); };
  const stopNative = () => { if (myTok) { delete voiceSinks[myTok]; myTok = 0; try { api().voice_stop(); } catch (e) {} } };
  const startNative = async (el, base, remember) => {
    const tok = ++voiceTok; myTok = tok; listening = true; btn.classList.add('mic-rec');
    let done = '';
    voiceSinks[tok] = {
      text: (t, final) => {
        if (final && t) done += (done && !/\s$/.test(done) ? ' ' : '') + t;   // an empty final: a guess Windows wasn't sure of, dropped
        const joined = final ? done : done + (done && t ? ' ' : '') + t;
        el.value = joined ? base + (base && !/\s$/.test(base) ? ' ' : '') + joined : base;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      end: () => { delete voiceSinks[tok]; if (myTok === tok) myTok = 0; stop(); },
    };
    let r = null; try { r = await api().voice_start(voiceLang(), tok); } catch (e) {}
    if (!r || r.error) { stopNative(); stop(); toast('Voice input', (r && r.error) || "Voice input isn't available right now."); return; }
    if (remember) try { localStorage.setItem('auoris_voice', 'native'); } catch (e) {}
  };
  const wire = () => {
    btn.hidden = false;
    btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation();
      if (listening) { if (myTok) { stopNative(); stop(); } else { try { rec && rec.stop(); } catch (err) {} } return; }
      const el = getEl(); if (!el) return;
      if (starting) return; starting = true;
      const ok = await micAccess();   // asks for permission up front; if it's blocked, tells them how to turn it on
      starting = false;
      if (!ok) return;
      const base = el.value;
      if (!SpeechRec || voiceNative()) return startNative(el, base, false);
      rec = new SpeechRec();
      rec.lang = voiceLang(); rec.interimResults = true; rec.continuous = true;
      listening = true; btn.classList.add('mic-rec');
      rec.onresult = ev => {
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
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') return micBlocked();
        startNative(el, base, true);   // the engine's speech service isn't reachable from here: use Windows' own recognizer instead
      };
      rec.onend = stop;
      try { rec.start(); } catch (err) { stop(); startNative(el, base, true); }
    };
  };
  if (SpeechRec) wire();
  else {   // no engine speech at all: show the button only if Windows' recognizer is there
    btn.hidden = true;
    window.addEventListener('pywebviewready', async () => { try { if (await api().voice_available()) wire(); } catch (e) {} });
  }
}

$('fileBtn').onclick = async () => renderAtts(await api().pick_files());
$('folderBtn').onclick = async () => renderAtts(await api().pick_folder());
attachMic($('micBtn'), () => $('input'));
$('cwdBtn').onclick = async () => setCwd(await api().set_cwd_dialog());
const comp = $('composer');
['dragenter', 'dragover'].forEach(e => document.addEventListener(e, ev => { ev.preventDefault(); comp.classList.add('drag'); }));
['dragleave', 'drop'].forEach(e => document.addEventListener(e, ev => { ev.preventDefault(); comp.classList.remove('drag'); }));
document.addEventListener('drop', ev => { if (ev.dataTransfer.files.length) addBlobs(ev.dataTransfer.files); });
input.addEventListener('paste', ev => { const fs = [...ev.clipboardData.files]; if (fs.length) { ev.preventDefault(); addBlobs(fs); } });

// ---- sending
async function send() {
  if (petBusy) return;
  const text0 = input.value.trim();
  const chips = [...$('atts').children];
  if (!text0 && !chips.length) return;
  let text = text0, petNoteFn = null, petAfter = false;
  if (text0 && !text0.startsWith('/') && !text0.startsWith('@') && petActive() && !call.on && petAnalyzeOnly()) petAfter = true;   // it can't change the prompt: send now, analyze after
  else if (text0 && !text0.startsWith('/') && !text0.startsWith('@') && petActive() && !call.on) {   // the active pet reads it first (extra AI usage, see Auoris Pets)
    petBusy = true; petChipPaint(true);
    // the chat bar empties at once and the message waits in the chat as "<pet> is reviewing…" (left in the bar it looked stuck)
    const atts0 = chips.map(c => ({ ...c.dataset }));
    input.value = ''; autosize(); $('atts').innerHTML = '';
    userMsg(text0, atts0); const pending = log.lastElementChild; pending.classList.add('petpending');
    pending.insertAdjacentHTML('beforeend', `<div class="petrev">${esc(petActive().name)} is reviewing…</div>`); scroll(true);
    try { const r = await petIntercept(text0); if (r === null) { input.value = text0; autosize(); renderAtts(atts0); return; } text = r.text; petNoteFn = r.note; }
    catch (e) { text = text0; }
    finally { petBusy = false; petChipPaint(); pending.remove(); }
  }
  const sb = $('sendBtn'); sb.classList.remove('launch'); void sb.offsetWidth; sb.classList.add('launch');
  xTtsStop();
  input.value = ''; autosize();
  const keptAtts = chips.map(c => ({ ...c.dataset }));
  $('atts').innerHTML = '';
  const res = await api().send(text || '(see attachments)');
  if (!res || !res.ok) { input.value = text0; autosize(); renderAtts(keptAtts); return; }
  if (res.queue) { paused = false; renderQueue(res.queue); }
  else setBusy(true);
  if (petNoteFn) petNoteFn();
  if (petAfter) petAnalyzeAfter(text0);
  firePluginChatEvent('user', text);
  scroll(true);
  return true;   // sent (or queued); every early return above means it wasn't
}
async function regenerate() {
  if (busy) return;
  const events = await api().regenerate();
  if (!events) return;
  renderHistory(events); removeTurnBar(); setBusy(true);
  api().start_regenerate();
}
function stopNow() {
  if (!busy) return;
  $('stopBtn').disabled = true; $('stopBtn').textContent = '…';
  api().stop();
}
$('sendBtn').onclick = send;
$('stopBtn').onclick = stopNow;
input.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const ctrlMode = prefs.send_key === 'ctrl';
  if (ctrlMode ? (e.ctrlKey || e.metaKey) : !e.shiftKey && !e.ctrlKey) { e.preventDefault(); send(); }
});
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 240) + 'px'; }
input.addEventListener('input', autosize);
$('newBtn').onclick = newChat;
$('search').oninput = drawChats;
function toggleSide() {
  if (document.body.getAttribute('data-m-side') === 'rail') { document.body.classList.toggle('rail-open'); return; }   // Rail model: expand to the full sidebar and back
  if (window.innerWidth <= 760) { document.body.classList.toggle('showside'); document.body.classList.remove('noside'); return; }
  document.body.classList.toggle('noside');
  try { localStorage.setItem('noside', document.body.classList.contains('noside') ? '1' : ''); } catch (e) {}
}
// Makes sure the sidebar (and its search box) is actually visible: unhides it, or expands the Rail model's icon strip
function ensureSide() {
  const b = document.body;
  if (b.getAttribute('data-m-side') === 'rail') b.classList.add('rail-open'); else if (b.classList.contains('noside')) toggleSide();
}
$('sideBtn').onclick = toggleSide;
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && k === 'n') { e.preventDefault(); $('incogBtn').click(); return; }
  if (e.ctrlKey && k === 'n') { e.preventDefault(); newChat(); }
  if (e.ctrlKey && k === 'b') { e.preventDefault(); toggleSide(); }
  if (e.ctrlKey && k === ',') { e.preventDefault(); openSettings('general'); }
  if (e.ctrlKey && k === 'k') { e.preventDefault(); ensureSide(); $('search').focus(); }
  if (e.ctrlKey && k === 'e') { e.preventDefault(); showView(view === 'explore' ? 'chat' : 'explore'); }
  if (e.ctrlKey && !e.altKey && e.key === '?') { e.preventDefault(); if (!e.repeat && !document.querySelector('dialog[open]')) { if (view !== 'chat') showView('chat'); cmdHelpOpen(); } return; }   // Ctrl+? = the ? commands popup
  if (e.ctrlKey && k === '/') { e.preventDefault(); showKeys(); }
  if (e.key === 'Escape') {
    // Esc that closes a panel, the tour or the find bar must not also stop the reply
    const hadMenu = document.querySelector('.pmenu:not([hidden]), #tasksPanel:not([hidden]), #tourBox, #findBar:not([hidden])');
    closeMenus();
    const typingElsewhere = e.target.matches && e.target.matches('input, textarea') && e.target !== input;
    if (!hadMenu && !typingElsewhere && busy && !editingId && !document.querySelector('dialog[open]')) stopNow();
  }
});

// ---- controls
// Risky modes aren't blocked, but switching to one shows a clear warning first (Terms section 4: you're responsible for what you let it do)
const PERM_RISK = {
  edits: ['Auto-accept edits', 'The AI will create, change and <b>delete files in your project without asking</b>. A mistake can overwrite or remove your work.'],
  ai: ['AI decides', 'The AI judges which file changes and commands are safe and <b>only asks when it is unsure</b>. Its judgement can be wrong, and it may run commands that change or delete things.'],
  all: ['Auto-accept all', '<b>Every file change and every command runs without asking</b>, including ones that delete files, install software or change settings on your PC.'],
};
async function permRiskOk(v) {
  const r = PERM_RISK[v]; if (!r || v === permNow) return true;
  return ask({ title: '⚠️ ' + r[0] + ': use with care', icon: '⚠️', danger: true, ok: 'Turn it on anyway',
    html: `<p>${r[1]}</p><p>AI can misunderstand you or make mistakes. <b>You are responsible for anything it does in this mode</b>, so keep backups (or use git) and only use it in folders where that is OK. "Ask before changes" is the safe choice.</p><p class="vsub">This is covered by section 4 of the Terms of Service.</p>` });
}
async function choosePerm(v) {
  if (!(await permRiskOk(v))) { setPerm(permNow); return false; }
  setPerm(v); api().set_setting('permission_mode', v); return true;
}
$('permSel').onchange = e => choosePerm(e.target.value);
$('effortSel').onchange = e => { prefs.effort = e.target.value; $('effortSel').classList.toggle('vibing', prefs.effort === 'vibing'); api().set_setting('effort', e.target.value); };
$('fastBtn').onclick = async () => {
  prefs.fast_mode = !prefs.fast_mode;
  $('fastBtn').classList.toggle('on', !!prefs.fast_mode);
  $('effortSel').disabled = $('thinkBtn').disabled = !!prefs.fast_mode;
  await api().set_setting('fast_mode', !!prefs.fast_mode);
  toast('Fast mode', prefs.fast_mode ? 'On - lowest effort, no thinking, short answers, fewest steps.' : 'Off');
};
$('thinkBtn').onclick = () => {
  const on = !$('thinkBtn').classList.contains('on');
  $('thinkBtn').classList.toggle('on', on);
  api().set_setting('deep_think', on);
};
$('sfxVolIn').oninput = () => { $('sfxVolLbl').textContent = $('sfxVolIn').value + '%'; };
$('sfxTestBtn').onclick = () => {  // audition with the slider's current (unsaved) values
  const saved = prefs.sfx_volume;
  prefs.sfx_volume = parseInt($('sfxVolIn').value, 10);
  Sfx.play('mention');
  setTimeout(() => { prefs.sfx_volume = saved; }, 800);
};
$('cancelSet').onclick = $('setX').onclick = () => { $('settings').close(); applyPrefs(); };
$('saveSet').onclick = async () => {
  const temp = $('tempIn').value.trim();
  const vals = {
    profile_name: $('profName').value.trim() || 'You', call_me: $('callMe').value.trim(), profile_color: setDraft.profile_color,
    custom_instructions: $('instrIn').value, ui_lang: $('uiLang').value, reply_lang: $('replyLang').value, send_key: $('sendKey').value,
    accent: setDraft.accent, font_scale: setDraft.font_scale, calm: $('calmIn').checked, show_stats: $('statsIn').checked,
    temperature: temp === '' ? null : parseFloat(temp), auto_ctx: $('autoCtxIn').checked, auto_compact: $('autoCompactIn').checked, compact_tokens: Math.max(2000, parseInt($('compactTokIn').value) || 700000), idle_unload_min: parseInt($('idleIn').value),
    hide_username: $('hideUserIn').checked, bio: $('profBio').value.trim(), pronouns: $('profPron').value.trim(), banner_color: setDraft.banner_color,
    name_effect: setDraft.name_effect, avatar_deco: setDraft.avatar_deco, profile_effect: setDraft.profile_effect,
    auto_update: $('autoUpdIn').checked, link_open: $('linkOpen').value, search_engine: $('searchEng').value,
    browser_home: $('bwHomeIn').value.trim() || 'https://duckduckgo.com', proxy_url: $('proxyUrl').value.trim(), proxy_enabled: $('proxyOn').checked,
    notif_dms: $('notifDmsIn').checked, notif_mentions: $('notifMentionsIn').checked, notif_groups: $('notifGroupsIn').checked, sfx_volume: parseInt($('sfxVolIn').value, 10),
    tts_auto: $('ttsAutoIn').checked, tts_voice: $('ttsVoiceIn').value, tts_rate: parseFloat($('ttsRateIn').value) || 1,
    tts_engine: $('ttsEngineIn').value, tts_piper_voice: $('ttsPiperVoiceIn').value || 'us-natural',
  };
  for (const [k, v] of Object.entries(vals)) { await api().set_setting(k, v); prefs[k] = v; }
  if (me) {  // push the cloud-visible subset (bio/color/banner/effect) - these used to stay local-only and never sync
    const { error: syncErr } = await sb.from('profiles').update({
      bio: vals.bio || null, pronouns: vals.pronouns || null, color: vals.profile_color || null,
      banner_color: vals.banner_color || null, effect: vals.profile_effect || 'none',
    }).eq('id', me.id);
    if (syncErr) toast('Profile', 'Saved locally, but some of it didn\'t sync to your account: ' + syncErr.message);
    else Object.assign(myProfile, { bio: vals.bio, pronouns: vals.pronouns || null, color: vals.profile_color, banner_color: vals.banner_color, effect: vals.profile_effect });
  }
  if ($('startupIn').checked !== !!prefs.start_with_windows) {
    if (await api().set_setting('start_with_windows', $('startupIn').checked)) prefs.start_with_windows = $('startupIn').checked;
    else toast(t('s.startup'), t('s.startupHint'));
  }
  if ($('boostIn').checked !== !!prefs.game_boost) {
    if ($('boostIn').checked && !isPlus(myProfile)) { $('boostIn').checked = false; toast('Gaming boost', 'Gaming boost is an Auoris Plus feature.'); }
    else if (await api().set_setting('game_boost', $('boostIn').checked)) prefs.game_boost = $('boostIn').checked;
  }
  if ($('ramOptIn').checked !== !!prefs.ram_opt && await api().set_setting('ram_opt', $('ramOptIn').checked)) prefs.ram_opt = $('ramOptIn').checked;
  if (+$('ramPctIn').value !== +(prefs.ram_opt_pct || 80) && await api().set_setting('ram_opt_pct', +$('ramPctIn').value)) prefs.ram_opt_pct = +$('ramPctIn').value;
  setMask(prefs.hide_username);
  applyPrefs();
  const newModel = $('modelIn').value.trim(), newCtx = +$('ctxIn').value;
  if (newModel !== prefs.model || newCtx !== +prefs.num_ctx) {
    if (!await api().set_model(newModel, newCtx)) { toast('Busy', 'Wait for the current reply to finish before changing the model.'); return; }
    prefs.model = newModel; prefs.num_ctx = newCtx;
  }
  $('settings').close();
};

// ================================================================ i18n
const LANGS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano', ru: 'Русский', ja: '日本語', zh: '中文' };
const REPLY_LANGS = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Dutch', 'Polish', 'Turkish', 'Arabic', 'Hindi'];
const I18N = {
en: { newChat: 'New chat', explore: 'Explore', routines: 'Routines', searchChats: 'Search chats', chat: 'Chat', code: 'Code', deepThink: 'Deep think',
  'effort.low': 'Effort: Low', 'effort.medium': 'Effort: Medium', 'effort.high': 'Effort: High', 'effort.max': 'Effort: Max',
  'effort.minimal': 'Effort: Minimal', 'effort.vibing': 'Effort: Vibing ✦',
  'perm.ask': 'Ask before changes', 'perm.edits': 'Auto-accept edits', 'perm.ai': 'AI decides (asks if unsure)', 'perm.all': 'Auto-accept all',
  incognito: 'Incognito', hideSidebar: 'Hide sidebar (Ctrl+B)', settings: 'Settings', usage: 'Usage', save: 'Save', cancel: 'Cancel',
  's.profile': 'Profile', 's.general': 'General', 's.appearance': 'Appearance', 's.model': 'Model', 's.privacy': 'Privacy & data', 's.localOnly': 'Stored only on this PC.',
  's.name': 'Display name', 's.color': 'Avatar color', 's.callMe': 'What should Auoris call you?', 's.callMePh': '(defaults to your display name)',
  's.instr': 'What should Auoris know about you? (added to every chat)', 's.instrPh': 'e.g. I\'m a nurse and prefer clear, step-by-step explanations.',
  's.uiLang': 'App language', 's.replyLang': 'Language the AI replies in', 's.sendKey': 'Send messages with', 's.enter': 'Enter (Shift+Enter for a new line)', 's.ctrlEnter': 'Ctrl+Enter (Enter for a new line)',
  's.startup': 'Start Auoris when I sign in to Windows', 's.startupHint': 'Only works from the installed .exe', 's.accent': 'Accent color', 's.textSize': 'Text size',
  's.small': 'Small', 's.default': 'Default', 's.large': 'Large', 's.xl': 'Extra large', 's.calm': 'Reduce animations', 's.calmHint': 'Turns off the slide / fade effects',
  's.stats': 'Show token stats', 's.statsHint': 'Token counts under replies and the context meter', 's.modelName': 'Ollama model', 's.maxCtx': 'Max context (num_ctx)', 's.temp': 'Temperature (blank = default)',
  's.autoCtx': 'Auto context', 's.autoCtxHint': 'Start small and grow as the chat gets longer — uses much less VRAM', 's.idle': 'Free VRAM when idle (unload the model after…)',
  's.never': 'Never (keep loaded while the app is open)', 's.findModels': 'Find more models in Explore →', 's.hideUser': 'Hide my username',
  's.hideUserHint': 'Shows paths as C:\\Users\\*****\\ everywhere on screen (the AI still uses the real paths)', 's.incog': 'Incognito chats', 's.incogHint': 'Use the incognito button in the top bar — those chats are never saved.',
  's.dataFolder': 'Your data', 's.openFolder': 'Open folder', 's.clearUsage': 'Clear usage stats', 's.clearUsageHint': 'Resets the token counters in Usage.', 's.clear': 'Clear',
  's.clearChats': 'Delete all chats', 's.clearChatsHint': 'Permanently deletes your whole chat history.', 's.deleteAll': 'Delete all',
  'ex.title': 'Explore models', 'ex.sub': 'Search GGUF models on Hugging Face and run them with Ollama.', 'ex.search': 'Search models — e.g. qwen coder, llama 3, uncensored, vision...', 'ex.installed': 'Installed',
  'rt.sub': 'Prompts that run on their own — each run becomes a chat. They run while Auoris is open; missed runs catch up when you open it.', 'rt.new': 'New routine',
  ph: 'Ask anything, mention a folder, or tell it what to build...', phChat: 'Message Auoris...', phBusy: 'Type a follow-up — it will be sent when the AI finishes its current step...',
  footEnter: 'Enter to send · Shift+Enter new line · / for commands · drop or paste files anywhere', footCtrl: 'Ctrl+Enter to send · Enter new line · / for commands · drop or paste files anywhere',
  emptyCode: 'What are we building?', emptyCodeSub: 'Reads your files and folders, writes code, runs commands, and builds projects on this PC.',
  emptyChat: 'How can I help{name}?', emptyChatSub: 'Chat mode — just talk. Switch to Code to work with files and commands.',
  incogBanner: '🕶 Incognito — this chat won’t be saved', autoLang: 'Same language I write in',
  'm.lang': 'Language', 'm.keys': 'Keyboard shortcuts', 'm.help': 'Help & tips', 'm.about': 'About Auoris', 'm.data': 'Open data folder', 'm.profile': 'Edit profile',
  today: 'Today', yesterday: 'Yesterday', week: 'Previous 7 days', month: 'Previous 30 days', older: 'Older', noChats: 'No saved chats yet.', noMatch: 'No matches.',
  sugg: ['Look at my Downloads folder and summarize what\'s there', 'Create a Python script that renames photos by date', 'Explain what\'s in the current working folder'],
  suggChat: ['Explain how neural networks learn, simply', 'Help me write a message to a friend', 'Give me 5 project ideas to learn coding'] },
es: { newChat: 'Nuevo chat', explore: 'Explorar', routines: 'Rutinas', searchChats: 'Buscar chats', chat: 'Chat', code: 'Código', deepThink: 'Pensar a fondo',
  'effort.low': 'Esfuerzo: Bajo', 'effort.medium': 'Esfuerzo: Medio', 'effort.high': 'Esfuerzo: Alto', 'effort.max': 'Esfuerzo: Máx', 'effort.minimal': 'Esfuerzo: Mínimo', 'effort.vibing': 'Esfuerzo: Vibing ✦',
  'perm.ask': 'Preguntar antes de cambios', 'perm.edits': 'Aceptar ediciones', 'perm.ai': 'La IA decide (pregunta si duda)', 'perm.all': 'Aceptar todo',
  incognito: 'Incógnito', hideSidebar: 'Ocultar barra lateral (Ctrl+B)', settings: 'Ajustes', usage: 'Uso', save: 'Guardar', cancel: 'Cancelar',
  's.profile': 'Perfil', 's.general': 'General', 's.appearance': 'Apariencia', 's.model': 'Modelo', 's.privacy': 'Privacidad y datos', 's.localOnly': 'Guardado solo en este PC.',
  's.name': 'Nombre', 's.color': 'Color del avatar', 's.callMe': '¿Cómo debe llamarte Auoris?', 's.callMePh': '(por defecto, tu nombre)',
  's.instr': '¿Qué debe saber Auoris sobre ti? (se añade a cada chat)', 's.instrPh': 'p. ej. Trabajo sobre todo con plugins de Minecraft en Java.',
  's.uiLang': 'Idioma de la app', 's.replyLang': 'Idioma de las respuestas', 's.sendKey': 'Enviar mensajes con', 's.enter': 'Enter (Mayús+Enter para nueva línea)', 's.ctrlEnter': 'Ctrl+Enter (Enter para nueva línea)',
  's.startup': 'Iniciar Auoris al entrar en Windows', 's.startupHint': 'Solo funciona desde el .exe', 's.accent': 'Color de acento', 's.textSize': 'Tamaño del texto',
  's.small': 'Pequeño', 's.default': 'Normal', 's.large': 'Grande', 's.xl': 'Muy grande', 's.calm': 'Reducir animaciones', 's.calmHint': 'Desactiva los efectos de movimiento',
  's.stats': 'Mostrar tokens', 's.statsHint': 'Tokens bajo las respuestas y medidor de contexto', 's.modelName': 'Modelo de Ollama', 's.maxCtx': 'Contexto máx. (num_ctx)', 's.temp': 'Temperatura (vacío = por defecto)',
  's.autoCtx': 'Contexto automático', 's.autoCtxHint': 'Empieza pequeño y crece con el chat — usa mucha menos VRAM', 's.idle': 'Liberar VRAM en reposo (descargar tras…)',
  's.never': 'Nunca (mantener cargado)', 's.findModels': 'Buscar más modelos en Explorar →', 's.hideUser': 'Ocultar mi nombre de usuario',
  's.hideUserHint': 'Muestra las rutas como C:\\Users\\*****\\ en pantalla (la IA usa las reales)', 's.incog': 'Chats de incógnito', 's.incogHint': 'Usa el botón de incógnito arriba — esos chats nunca se guardan.',
  's.dataFolder': 'Tus datos', 's.openFolder': 'Abrir carpeta', 's.clearUsage': 'Borrar estadísticas', 's.clearUsageHint': 'Reinicia los contadores de Uso.', 's.clear': 'Borrar',
  's.clearChats': 'Eliminar todos los chats', 's.clearChatsHint': 'Elimina para siempre todo el historial.', 's.deleteAll': 'Eliminar todo',
  'ex.title': 'Explorar modelos', 'ex.sub': 'Busca modelos GGUF en Hugging Face y úsalos con Ollama.', 'ex.search': 'Buscar modelos — p. ej. qwen coder, llama 3, vision...', 'ex.installed': 'Instalados',
  'rt.sub': 'Prompts que se ejecutan solos — cada ejecución es un chat. Funcionan con Auoris abierto.', 'rt.new': 'Nueva rutina',
  ph: 'Pregunta lo que quieras, menciona una carpeta o di qué construir...', phChat: 'Escribe a Auoris...', phBusy: 'Escribe otro mensaje — se enviará cuando la IA termine este paso...',
  footEnter: 'Enter para enviar · Mayús+Enter nueva línea · / comandos', footCtrl: 'Ctrl+Enter para enviar · Enter nueva línea · / comandos',
  emptyCode: '¿Qué construimos?', emptyCodeSub: 'Lee tus archivos, escribe código, ejecuta comandos y compila proyectos en este PC.',
  emptyChat: '¿En qué te ayudo{name}?', emptyChatSub: 'Modo chat — solo conversar. Cambia a Código para trabajar con archivos.',
  incogBanner: '🕶 Incógnito — este chat no se guardará', autoLang: 'El mismo idioma en que escribo',
  'm.lang': 'Idioma', 'm.keys': 'Atajos de teclado', 'm.help': 'Ayuda y consejos', 'm.about': 'Acerca de Auoris', 'm.data': 'Abrir carpeta de datos', 'm.profile': 'Editar perfil',
  today: 'Hoy', yesterday: 'Ayer', week: 'Últimos 7 días', month: 'Últimos 30 días', older: 'Anteriores', noChats: 'Aún no hay chats.', noMatch: 'Sin resultados.',
  sugg: ['Mira mi carpeta de Descargas y resume lo que hay', 'Crea un script de Python que renombre fotos por fecha', 'Explica qué hay en la carpeta actual'],
  suggChat: ['Explícame cómo aprenden las redes neuronales', 'Ayúdame a escribir un mensaje a un amigo', 'Dame 5 ideas de proyectos para aprender a programar'] },
fr: { newChat: 'Nouveau chat', explore: 'Explorer', routines: 'Routines', searchChats: 'Rechercher', chat: 'Chat', code: 'Code', deepThink: 'Réflexion',
  'effort.low': 'Effort : Faible', 'effort.medium': 'Effort : Moyen', 'effort.high': 'Effort : Élevé', 'effort.max': 'Effort : Max', 'effort.minimal': 'Effort : Minimal', 'effort.vibing': 'Effort : Vibing ✦',
  'perm.ask': 'Demander avant', 'perm.edits': 'Accepter les modifs', 'perm.ai': "L'IA décide (demande si doute)", 'perm.all': 'Tout accepter',
  incognito: 'Incognito', hideSidebar: 'Masquer la barre (Ctrl+B)', settings: 'Paramètres', usage: 'Utilisation', save: 'Enregistrer', cancel: 'Annuler',
  's.profile': 'Profil', 's.general': 'Général', 's.appearance': 'Apparence', 's.model': 'Modèle', 's.privacy': 'Confidentialité', 's.localOnly': 'Stocké uniquement sur ce PC.',
  's.name': 'Nom affiché', 's.color': "Couleur de l'avatar", 's.callMe': 'Comment Auoris doit-il vous appeler ?', 's.callMePh': '(par défaut, votre nom)',
  's.instr': 'Que doit savoir Auoris sur vous ? (ajouté à chaque chat)', 's.instrPh': 'ex. Je fais surtout des plugins Minecraft en Java.',
  's.uiLang': "Langue de l'app", 's.replyLang': "Langue des réponses de l'IA", 's.sendKey': 'Envoyer avec', 's.enter': 'Entrée (Maj+Entrée = nouvelle ligne)', 's.ctrlEnter': 'Ctrl+Entrée (Entrée = nouvelle ligne)',
  's.startup': 'Lancer Auoris au démarrage de Windows', 's.startupHint': "Uniquement depuis l'exe", 's.accent': "Couleur d'accent", 's.textSize': 'Taille du texte',
  's.small': 'Petit', 's.default': 'Normal', 's.large': 'Grand', 's.xl': 'Très grand', 's.calm': 'Réduire les animations', 's.calmHint': 'Désactive les effets de mouvement',
  's.stats': 'Afficher les tokens', 's.statsHint': 'Tokens sous les réponses et jauge de contexte', 's.modelName': 'Modèle Ollama', 's.maxCtx': 'Contexte max (num_ctx)', 's.temp': 'Température (vide = défaut)',
  's.autoCtx': 'Contexte automatique', 's.autoCtxHint': 'Commence petit et grandit — bien moins de VRAM', 's.idle': 'Libérer la VRAM au repos (décharger après…)',
  's.never': 'Jamais', 's.findModels': "Plus de modèles dans Explorer →", 's.hideUser': "Masquer mon nom d'utilisateur",
  's.hideUserHint': "Affiche C:\\Users\\*****\\ à l'écran (l'IA utilise les vrais chemins)", 's.incog': 'Chats incognito', 's.incogHint': 'Bouton incognito en haut — jamais enregistrés.',
  's.dataFolder': 'Vos données', 's.openFolder': 'Ouvrir le dossier', 's.clearUsage': 'Effacer les stats', 's.clearUsageHint': 'Remet les compteurs à zéro.', 's.clear': 'Effacer',
  's.clearChats': 'Supprimer tous les chats', 's.clearChatsHint': "Supprime définitivement tout l'historique.", 's.deleteAll': 'Tout supprimer',
  'ex.title': 'Explorer les modèles', 'ex.sub': 'Cherchez des modèles GGUF sur Hugging Face et lancez-les avec Ollama.', 'ex.search': 'Rechercher — ex. qwen coder, llama 3, vision...', 'ex.installed': 'Installés',
  'rt.sub': "Des prompts qui s'exécutent seuls — chaque exécution devient un chat.", 'rt.new': 'Nouvelle routine',
  ph: 'Demandez ce que vous voulez, citez un dossier ou dites quoi construire...', phChat: 'Écrire à Auoris...', phBusy: "Tapez une suite — envoyée quand l'IA aura fini cette étape...",
  footEnter: 'Entrée pour envoyer · Maj+Entrée nouvelle ligne · / commandes', footCtrl: 'Ctrl+Entrée pour envoyer · Entrée nouvelle ligne · / commandes',
  emptyCode: 'On construit quoi ?', emptyCodeSub: 'Lit vos fichiers, écrit du code, lance des commandes et compile sur ce PC.',
  emptyChat: 'Comment puis-je aider{name} ?', emptyChatSub: 'Mode chat — discutez. Passez en Code pour les fichiers.',
  incogBanner: '🕶 Incognito — ce chat ne sera pas enregistré', autoLang: "La langue dans laquelle j'écris",
  'm.lang': 'Langue', 'm.keys': 'Raccourcis clavier', 'm.help': 'Aide et astuces', 'm.about': 'À propos de Auoris', 'm.data': 'Ouvrir le dossier des données', 'm.profile': 'Modifier le profil',
  today: "Aujourd'hui", yesterday: 'Hier', week: '7 derniers jours', month: '30 derniers jours', older: 'Plus ancien', noChats: 'Aucun chat.', noMatch: 'Aucun résultat.',
  sugg: ['Regarde mon dossier Téléchargements et résume-le', 'Crée un script Python qui renomme des photos par date', 'Explique le contenu du dossier actuel'],
  suggChat: ['Explique simplement comment apprend un réseau de neurones', "Aide-moi à écrire un message à un ami", '5 idées de projets pour apprendre à coder'] },
de: { newChat: 'Neuer Chat', explore: 'Entdecken', routines: 'Routinen', searchChats: 'Chats suchen', chat: 'Chat', code: 'Code', deepThink: 'Gründlich denken',
  'effort.low': 'Aufwand: Niedrig', 'effort.medium': 'Aufwand: Mittel', 'effort.high': 'Aufwand: Hoch', 'effort.max': 'Aufwand: Max', 'effort.minimal': 'Aufwand: Minimal', 'effort.vibing': 'Aufwand: Vibing ✦',
  'perm.ask': 'Vor Änderungen fragen', 'perm.edits': 'Änderungen erlauben', 'perm.ai': 'KI entscheidet (fragt bei Zweifel)', 'perm.all': 'Alles erlauben',
  incognito: 'Inkognito', hideSidebar: 'Seitenleiste ausblenden (Strg+B)', settings: 'Einstellungen', usage: 'Nutzung', save: 'Speichern', cancel: 'Abbrechen',
  's.profile': 'Profil', 's.general': 'Allgemein', 's.appearance': 'Darstellung', 's.model': 'Modell', 's.privacy': 'Datenschutz', 's.localOnly': 'Nur auf diesem PC gespeichert.',
  's.name': 'Anzeigename', 's.color': 'Avatarfarbe', 's.callMe': 'Wie soll Auoris dich nennen?', 's.callMePh': '(standardmäßig dein Name)',
  's.instr': 'Was soll Auoris über dich wissen? (in jedem Chat)', 's.instrPh': 'z. B. Ich baue meist Minecraft-Plugins in Java.',
  's.uiLang': 'App-Sprache', 's.replyLang': 'Antwortsprache der KI', 's.sendKey': 'Senden mit', 's.enter': 'Enter (Umschalt+Enter = neue Zeile)', 's.ctrlEnter': 'Strg+Enter (Enter = neue Zeile)',
  's.startup': 'Auoris beim Windows-Start öffnen', 's.startupHint': 'Nur mit der .exe', 's.accent': 'Akzentfarbe', 's.textSize': 'Textgröße',
  's.small': 'Klein', 's.default': 'Normal', 's.large': 'Groß', 's.xl': 'Sehr groß', 's.calm': 'Animationen reduzieren', 's.calmHint': 'Schaltet Bewegungseffekte aus',
  's.stats': 'Token-Statistik zeigen', 's.statsHint': 'Tokens unter Antworten und Kontextanzeige', 's.modelName': 'Ollama-Modell', 's.maxCtx': 'Max. Kontext (num_ctx)', 's.temp': 'Temperatur (leer = Standard)',
  's.autoCtx': 'Automatischer Kontext', 's.autoCtxHint': 'Startet klein und wächst mit — viel weniger VRAM', 's.idle': 'VRAM im Leerlauf freigeben (entladen nach…)',
  's.never': 'Nie', 's.findModels': 'Mehr Modelle unter Entdecken →', 's.hideUser': 'Benutzernamen ausblenden',
  's.hideUserHint': 'Zeigt Pfade als C:\\Users\\*****\\ an (die KI nutzt die echten)', 's.incog': 'Inkognito-Chats', 's.incogHint': 'Inkognito-Knopf oben — wird nie gespeichert.',
  's.dataFolder': 'Deine Daten', 's.openFolder': 'Ordner öffnen', 's.clearUsage': 'Statistik löschen', 's.clearUsageHint': 'Setzt die Zähler zurück.', 's.clear': 'Löschen',
  's.clearChats': 'Alle Chats löschen', 's.clearChatsHint': 'Löscht den gesamten Verlauf endgültig.', 's.deleteAll': 'Alle löschen',
  'ex.title': 'Modelle entdecken', 'ex.sub': 'GGUF-Modelle auf Hugging Face suchen und mit Ollama nutzen.', 'ex.search': 'Modelle suchen — z. B. qwen coder, llama 3, vision...', 'ex.installed': 'Installiert',
  'rt.sub': 'Prompts, die von selbst laufen — jeder Lauf wird ein Chat.', 'rt.new': 'Neue Routine',
  ph: 'Frag etwas, nenne einen Ordner oder sag, was gebaut werden soll...', phChat: 'Nachricht an Auoris...', phBusy: 'Nachricht vormerken — wird nach diesem Schritt gesendet...',
  footEnter: 'Enter senden · Umschalt+Enter neue Zeile · / Befehle', footCtrl: 'Strg+Enter senden · Enter neue Zeile · / Befehle',
  emptyCode: 'Was bauen wir?', emptyCodeSub: 'Liest Dateien, schreibt Code, führt Befehle aus und baut Projekte auf diesem PC.',
  emptyChat: 'Wie kann ich helfen{name}?', emptyChatSub: 'Chat-Modus — einfach reden. Für Dateien zu Code wechseln.',
  incogBanner: '🕶 Inkognito — dieser Chat wird nicht gespeichert', autoLang: 'Die Sprache, in der ich schreibe',
  'm.lang': 'Sprache', 'm.keys': 'Tastenkürzel', 'm.help': 'Hilfe & Tipps', 'm.about': 'Über Auoris', 'm.data': 'Datenordner öffnen', 'm.profile': 'Profil bearbeiten',
  today: 'Heute', yesterday: 'Gestern', week: 'Letzte 7 Tage', month: 'Letzte 30 Tage', older: 'Älter', noChats: 'Noch keine Chats.', noMatch: 'Keine Treffer.',
  sugg: ['Sieh dir meinen Downloads-Ordner an und fasse ihn zusammen', 'Erstelle ein Python-Skript, das Fotos nach Datum umbenennt', 'Erkläre, was im aktuellen Ordner ist'],
  suggChat: ['Erkläre einfach, wie neuronale Netze lernen', 'Hilf mir, einem Freund zu schreiben', '5 Projektideen zum Programmierenlernen'] },
pt: { newChat: 'Novo chat', explore: 'Explorar', routines: 'Rotinas', searchChats: 'Buscar chats', chat: 'Chat', code: 'Código', deepThink: 'Pensar a fundo',
  'effort.low': 'Esforço: Baixo', 'effort.medium': 'Esforço: Médio', 'effort.high': 'Esforço: Alto', 'effort.max': 'Esforço: Máx', 'effort.minimal': 'Esforço: Mínimo', 'effort.vibing': 'Esforço: Vibing ✦',
  'perm.ask': 'Perguntar antes', 'perm.edits': 'Aceitar edições', 'perm.ai': 'A IA decide (pergunta se incerta)', 'perm.all': 'Aceitar tudo',
  incognito: 'Anônimo', hideSidebar: 'Ocultar barra (Ctrl+B)', settings: 'Configurações', usage: 'Uso', save: 'Salvar', cancel: 'Cancelar',
  's.profile': 'Perfil', 's.general': 'Geral', 's.appearance': 'Aparência', 's.model': 'Modelo', 's.privacy': 'Privacidade', 's.localOnly': 'Salvo só neste PC.',
  's.name': 'Nome de exibição', 's.color': 'Cor do avatar', 's.callMe': 'Como o Auoris deve te chamar?', 's.callMePh': '(padrão: seu nome)',
  's.instr': 'O que o Auoris deve saber sobre você?', 's.instrPh': 'ex. Trabalho com plugins de Minecraft em Java.',
  's.uiLang': 'Idioma do app', 's.replyLang': 'Idioma das respostas', 's.sendKey': 'Enviar com', 's.enter': 'Enter (Shift+Enter nova linha)', 's.ctrlEnter': 'Ctrl+Enter (Enter nova linha)',
  's.startup': 'Abrir o Auoris ao entrar no Windows', 's.startupHint': 'Só funciona pelo .exe', 's.accent': 'Cor de destaque', 's.textSize': 'Tamanho do texto',
  's.small': 'Pequeno', 's.default': 'Padrão', 's.large': 'Grande', 's.xl': 'Muito grande', 's.calm': 'Reduzir animações', 's.calmHint': 'Desliga efeitos de movimento',
  's.stats': 'Mostrar tokens', 's.statsHint': 'Tokens nas respostas e medidor de contexto', 's.modelName': 'Modelo do Ollama', 's.maxCtx': 'Contexto máx. (num_ctx)', 's.temp': 'Temperatura (vazio = padrão)',
  's.autoCtx': 'Contexto automático', 's.autoCtxHint': 'Começa pequeno e cresce — bem menos VRAM', 's.idle': 'Liberar VRAM ocioso (descarregar após…)',
  's.never': 'Nunca', 's.findModels': 'Mais modelos em Explorar →', 's.hideUser': 'Ocultar meu usuário',
  's.hideUserHint': 'Mostra C:\\Users\\*****\\ na tela (a IA usa os caminhos reais)', 's.incog': 'Chats anônimos', 's.incogHint': 'Botão anônimo no topo — nunca são salvos.',
  's.dataFolder': 'Seus dados', 's.openFolder': 'Abrir pasta', 's.clearUsage': 'Limpar estatísticas', 's.clearUsageHint': 'Zera os contadores.', 's.clear': 'Limpar',
  's.clearChats': 'Excluir todos os chats', 's.clearChatsHint': 'Exclui todo o histórico para sempre.', 's.deleteAll': 'Excluir tudo',
  'ex.title': 'Explorar modelos', 'ex.sub': 'Busque modelos GGUF no Hugging Face e rode com o Ollama.', 'ex.search': 'Buscar modelos — ex. qwen coder, llama 3, vision...', 'ex.installed': 'Instalados',
  'rt.sub': 'Prompts que rodam sozinhos — cada execução vira um chat.', 'rt.new': 'Nova rotina',
  ph: 'Pergunte algo, cite uma pasta ou diga o que construir...', phChat: 'Mensagem para o Auoris...', phBusy: 'Digite o próximo — será enviado após esta etapa...',
  footEnter: 'Enter envia · Shift+Enter nova linha · / comandos', footCtrl: 'Ctrl+Enter envia · Enter nova linha · / comandos',
  emptyCode: 'O que vamos construir?', emptyCodeSub: 'Lê seus arquivos, escreve código, roda comandos e compila projetos neste PC.',
  emptyChat: 'Como posso ajudar{name}?', emptyChatSub: 'Modo chat — só conversa. Troque para Código para arquivos.',
  incogBanner: '🕶 Anônimo — este chat não será salvo', autoLang: 'O mesmo idioma em que escrevo',
  'm.lang': 'Idioma', 'm.keys': 'Atalhos de teclado', 'm.help': 'Ajuda e dicas', 'm.about': 'Sobre o Auoris', 'm.data': 'Abrir pasta de dados', 'm.profile': 'Editar perfil',
  today: 'Hoje', yesterday: 'Ontem', week: 'Últimos 7 dias', month: 'Últimos 30 dias', older: 'Mais antigos', noChats: 'Nenhum chat ainda.', noMatch: 'Nada encontrado.',
  sugg: ['Veja minha pasta Downloads e resuma', 'Crie um script Python que renomeia fotos por data', 'Explique o que há na pasta atual'],
  suggChat: ['Explique como redes neurais aprendem', 'Me ajude a escrever para um amigo', '5 ideias de projetos para aprender a programar'] },
it: { newChat: 'Nuova chat', explore: 'Esplora', routines: 'Routine', searchChats: 'Cerca chat', chat: 'Chat', code: 'Codice', deepThink: 'Pensa a fondo',
  'effort.low': 'Impegno: Basso', 'effort.medium': 'Impegno: Medio', 'effort.high': 'Impegno: Alto', 'effort.max': 'Impegno: Max', 'effort.minimal': 'Impegno: Minimo', 'effort.vibing': 'Impegno: Vibing ✦',
  'perm.ask': 'Chiedi prima', 'perm.edits': 'Accetta modifiche', 'perm.ai': "Decide l'IA (chiede se incerta)", 'perm.all': 'Accetta tutto',
  incognito: 'Incognito', hideSidebar: 'Nascondi barra (Ctrl+B)', settings: 'Impostazioni', usage: 'Utilizzo', save: 'Salva', cancel: 'Annulla',
  's.profile': 'Profilo', 's.general': 'Generale', 's.appearance': 'Aspetto', 's.model': 'Modello', 's.privacy': 'Privacy e dati', 's.localOnly': 'Salvato solo su questo PC.',
  's.name': 'Nome', 's.color': "Colore dell'avatar", 's.callMe': 'Come deve chiamarti Auoris?', 's.callMePh': '(predefinito: il tuo nome)',
  's.instr': 'Cosa deve sapere Auoris di te?', 's.instrPh': 'es. Lavoro su plugin Minecraft in Java.',
  's.uiLang': "Lingua dell'app", 's.replyLang': "Lingua delle risposte", 's.sendKey': 'Invia con', 's.enter': 'Invio (Maiusc+Invio nuova riga)', 's.ctrlEnter': 'Ctrl+Invio (Invio nuova riga)',
  's.startup': "Avvia Auoris all'accesso a Windows", 's.startupHint': "Solo dall'exe", 's.accent': 'Colore di accento', 's.textSize': 'Dimensione testo',
  's.small': 'Piccolo', 's.default': 'Normale', 's.large': 'Grande', 's.xl': 'Molto grande', 's.calm': 'Riduci animazioni', 's.calmHint': 'Disattiva gli effetti',
  's.stats': 'Mostra token', 's.statsHint': 'Token sotto le risposte e misuratore di contesto', 's.modelName': 'Modello Ollama', 's.maxCtx': 'Contesto max (num_ctx)', 's.temp': 'Temperatura (vuoto = predefinita)',
  's.autoCtx': 'Contesto automatico', 's.autoCtxHint': 'Parte piccolo e cresce — molta meno VRAM', 's.idle': 'Libera VRAM se inattivo (scarica dopo…)',
  's.never': 'Mai', 's.findModels': 'Altri modelli in Esplora →', 's.hideUser': 'Nascondi il mio nome utente',
  's.hideUserHint': "Mostra C:\\Users\\*****\\ sullo schermo (l'IA usa i percorsi reali)", 's.incog': 'Chat in incognito', 's.incogHint': 'Pulsante incognito in alto — mai salvate.',
  's.dataFolder': 'I tuoi dati', 's.openFolder': 'Apri cartella', 's.clearUsage': 'Azzera statistiche', 's.clearUsageHint': 'Azzera i contatori.', 's.clear': 'Azzera',
  's.clearChats': 'Elimina tutte le chat', 's.clearChatsHint': 'Elimina per sempre la cronologia.', 's.deleteAll': 'Elimina tutto',
  'ex.title': 'Esplora modelli', 'ex.sub': 'Cerca modelli GGUF su Hugging Face e usali con Ollama.', 'ex.search': 'Cerca modelli — es. qwen coder, llama 3, vision...', 'ex.installed': 'Installati',
  'rt.sub': 'Prompt che partono da soli — ogni esecuzione diventa una chat.', 'rt.new': 'Nuova routine',
  ph: 'Chiedi qualsiasi cosa, cita una cartella o di\' cosa costruire...', phChat: 'Scrivi a Auoris...', phBusy: 'Scrivi il prossimo — verrà inviato dopo questo passo...',
  footEnter: 'Invio per inviare · Maiusc+Invio nuova riga · / comandi', footCtrl: 'Ctrl+Invio per inviare · Invio nuova riga · / comandi',
  emptyCode: 'Cosa costruiamo?', emptyCodeSub: 'Legge i file, scrive codice, esegue comandi e compila progetti su questo PC.',
  emptyChat: 'Come posso aiutarti{name}?', emptyChatSub: 'Modalità chat — solo conversazione. Passa a Codice per i file.',
  incogBanner: '🕶 Incognito — questa chat non verrà salvata', autoLang: 'La lingua in cui scrivo',
  'm.lang': 'Lingua', 'm.keys': 'Scorciatoie', 'm.help': 'Aiuto e consigli', 'm.about': 'Info su Auoris', 'm.data': 'Apri cartella dati', 'm.profile': 'Modifica profilo',
  today: 'Oggi', yesterday: 'Ieri', week: 'Ultimi 7 giorni', month: 'Ultimi 30 giorni', older: 'Meno recenti', noChats: 'Nessuna chat.', noMatch: 'Nessun risultato.',
  sugg: ['Guarda la mia cartella Download e riassumila', 'Crea uno script Python che rinomina le foto per data', 'Spiega cosa c\'è nella cartella attuale'],
  suggChat: ['Spiegami come imparano le reti neurali', 'Aiutami a scrivere a un amico', '5 idee di progetti per imparare a programmare'] },
ru: { newChat: 'Новый чат', explore: 'Обзор', routines: 'Рутины', searchChats: 'Поиск чатов', chat: 'Чат', code: 'Код', deepThink: 'Глубокое мышление',
  'effort.low': 'Усилие: низкое', 'effort.medium': 'Усилие: среднее', 'effort.high': 'Усилие: высокое', 'effort.max': 'Усилие: макс', 'effort.minimal': 'Усилие: минимальное', 'effort.vibing': 'Усилие: Vibing ✦',
  'perm.ask': 'Спрашивать перед изменениями', 'perm.edits': 'Разрешать правки', 'perm.ai': 'Решает ИИ (спросит, если не уверен)', 'perm.all': 'Разрешать всё',
  incognito: 'Инкогнито', hideSidebar: 'Скрыть панель (Ctrl+B)', settings: 'Настройки', usage: 'Использование', save: 'Сохранить', cancel: 'Отмена',
  's.profile': 'Профиль', 's.general': 'Общие', 's.appearance': 'Внешний вид', 's.model': 'Модель', 's.privacy': 'Приватность', 's.localOnly': 'Хранится только на этом ПК.',
  's.name': 'Имя', 's.color': 'Цвет аватара', 's.callMe': 'Как Auoris должен вас называть?', 's.callMePh': '(по умолчанию — ваше имя)',
  's.instr': 'Что Auoris должен знать о вас?', 's.instrPh': 'напр. Я пишу плагины для Minecraft на Java.',
  's.uiLang': 'Язык приложения', 's.replyLang': 'Язык ответов ИИ', 's.sendKey': 'Отправлять по', 's.enter': 'Enter (Shift+Enter — новая строка)', 's.ctrlEnter': 'Ctrl+Enter (Enter — новая строка)',
  's.startup': 'Запускать Auoris при входе в Windows', 's.startupHint': 'Только из .exe', 's.accent': 'Цвет акцента', 's.textSize': 'Размер текста',
  's.small': 'Мелкий', 's.default': 'Обычный', 's.large': 'Крупный', 's.xl': 'Очень крупный', 's.calm': 'Меньше анимаций', 's.calmHint': 'Отключает эффекты движения',
  's.stats': 'Показывать токены', 's.statsHint': 'Токены под ответами и индикатор контекста', 's.modelName': 'Модель Ollama', 's.maxCtx': 'Макс. контекст (num_ctx)', 's.temp': 'Температура (пусто = по умолчанию)',
  's.autoCtx': 'Авто-контекст', 's.autoCtxHint': 'Начинает с малого и растёт — гораздо меньше VRAM', 's.idle': 'Освобождать VRAM при простое (выгрузить через…)',
  's.never': 'Никогда', 's.findModels': 'Больше моделей в Обзоре →', 's.hideUser': 'Скрывать имя пользователя',
  's.hideUserHint': 'Показывает C:\\Users\\*****\\ на экране (ИИ использует реальные пути)', 's.incog': 'Чаты инкогнито', 's.incogHint': 'Кнопка инкогнито вверху — такие чаты не сохраняются.',
  's.dataFolder': 'Ваши данные', 's.openFolder': 'Открыть папку', 's.clearUsage': 'Сбросить статистику', 's.clearUsageHint': 'Обнуляет счётчики.', 's.clear': 'Сбросить',
  's.clearChats': 'Удалить все чаты', 's.clearChatsHint': 'Навсегда удаляет всю историю.', 's.deleteAll': 'Удалить всё',
  'ex.title': 'Обзор моделей', 'ex.sub': 'Ищите GGUF-модели на Hugging Face и запускайте в Ollama.', 'ex.search': 'Поиск — напр. qwen coder, llama 3, vision...', 'ex.installed': 'Установлены',
  'rt.sub': 'Промпты, которые запускаются сами — каждый запуск становится чатом.', 'rt.new': 'Новая рутина',
  ph: 'Спросите что угодно, укажите папку или скажите, что собрать...', phChat: 'Сообщение для Auoris...', phBusy: 'Напишите следующее — отправится после этого шага...',
  footEnter: 'Enter — отправить · Shift+Enter — строка · / команды', footCtrl: 'Ctrl+Enter — отправить · Enter — строка · / команды',
  emptyCode: 'Что строим?', emptyCodeSub: 'Читает файлы, пишет код, выполняет команды и собирает проекты на этом ПК.',
  emptyChat: 'Чем помочь{name}?', emptyChatSub: 'Режим чата — просто разговор. Для файлов переключитесь на Код.',
  incogBanner: '🕶 Инкогнито — этот чат не сохранится', autoLang: 'На языке, на котором я пишу',
  'm.lang': 'Язык', 'm.keys': 'Горячие клавиши', 'm.help': 'Помощь и советы', 'm.about': 'О Auoris', 'm.data': 'Открыть папку данных', 'm.profile': 'Изменить профиль',
  today: 'Сегодня', yesterday: 'Вчера', week: 'Последние 7 дней', month: 'Последние 30 дней', older: 'Ранее', noChats: 'Чатов пока нет.', noMatch: 'Ничего не найдено.',
  sugg: ['Посмотри папку Загрузки и опиши, что там', 'Напиши скрипт на Python, который переименует фото по дате', 'Объясни, что в текущей папке'],
  suggChat: ['Объясни просто, как учатся нейросети', 'Помоги написать сообщение другу', '5 идей проектов, чтобы научиться программировать'] },
ja: { newChat: '新しいチャット', explore: '探す', routines: 'ルーティン', searchChats: 'チャットを検索', chat: 'チャット', code: 'コード', deepThink: 'じっくり考える',
  'effort.low': '労力: 低', 'effort.medium': '労力: 中', 'effort.high': '労力: 高', 'effort.max': '労力: 最大', 'effort.minimal': '労力: 最小', 'effort.vibing': '労力: Vibing ✦',
  'perm.ask': '変更前に確認', 'perm.edits': '編集を自動許可', 'perm.ai': 'AIが判断（不明なら確認）', 'perm.all': 'すべて自動許可',
  incognito: 'シークレット', hideSidebar: 'サイドバーを隠す (Ctrl+B)', settings: '設定', usage: '使用状況', save: '保存', cancel: 'キャンセル',
  's.profile': 'プロフィール', 's.general': '一般', 's.appearance': '外観', 's.model': 'モデル', 's.privacy': 'プライバシー', 's.localOnly': 'このPCにのみ保存されます。',
  's.name': '表示名', 's.color': 'アバターの色', 's.callMe': 'Auorisにどう呼ばれたいですか？', 's.callMePh': '（既定は表示名）',
  's.instr': 'Auorisに知ってほしいこと（毎回追加）', 's.instrPh': '例：主にJavaでMinecraftプラグインを作っています。',
  's.uiLang': 'アプリの言語', 's.replyLang': 'AIの返答言語', 's.sendKey': '送信キー', 's.enter': 'Enter（Shift+Enterで改行）', 's.ctrlEnter': 'Ctrl+Enter（Enterで改行）',
  's.startup': 'Windowsサインイン時に起動', 's.startupHint': '.exe からのみ有効', 's.accent': 'アクセントカラー', 's.textSize': '文字サイズ',
  's.small': '小', 's.default': '標準', 's.large': '大', 's.xl': '特大', 's.calm': 'アニメーションを減らす', 's.calmHint': '動きの効果をオフにします',
  's.stats': 'トークン数を表示', 's.statsHint': '返答の下のトークン数とコンテキストメーター', 's.modelName': 'Ollamaモデル', 's.maxCtx': '最大コンテキスト (num_ctx)', 's.temp': '温度（空欄=既定）',
  's.autoCtx': '自動コンテキスト', 's.autoCtxHint': '小さく始めて必要に応じて拡大 — VRAMを大幅節約', 's.idle': 'アイドル時にVRAMを解放（アンロードまで）',
  's.never': 'しない', 's.findModels': '「探す」でモデルを見つける →', 's.hideUser': 'ユーザー名を隠す',
  's.hideUserHint': '画面上では C:\\Users\\*****\\ と表示（AIは実際のパスを使用）', 's.incog': 'シークレットチャット', 's.incogHint': '上部のボタンから。保存されません。',
  's.dataFolder': 'データ', 's.openFolder': 'フォルダを開く', 's.clearUsage': '統計をリセット', 's.clearUsageHint': 'トークン数をリセットします。', 's.clear': 'リセット',
  's.clearChats': 'すべてのチャットを削除', 's.clearChatsHint': '履歴を完全に削除します。', 's.deleteAll': 'すべて削除',
  'ex.title': 'モデルを探す', 'ex.sub': 'Hugging FaceのGGUFモデルを検索してOllamaで実行。', 'ex.search': 'モデルを検索 — 例: qwen coder, llama 3, vision...', 'ex.installed': 'インストール済み',
  'rt.sub': '自動で実行されるプロンプト — 実行ごとにチャットになります。', 'rt.new': '新しいルーティン',
  ph: '何でも質問、フォルダを指定、作りたいものを伝えて...', phChat: 'Auorisにメッセージ...', phBusy: '次のメッセージを入力 — このステップ後に送信されます...',
  footEnter: 'Enterで送信 · Shift+Enterで改行 · / でコマンド', footCtrl: 'Ctrl+Enterで送信 · Enterで改行 · / でコマンド',
  emptyCode: '何を作りますか？', emptyCodeSub: 'ファイルを読み、コードを書き、コマンドを実行し、このPCでビルドします。',
  emptyChat: 'どうお手伝いしましょう{name}？', emptyChatSub: 'チャットモード — 会話のみ。ファイル操作はコードへ。',
  incogBanner: '🕶 シークレット — このチャットは保存されません', autoLang: '私が書いた言語',
  'm.lang': '言語', 'm.keys': 'キーボードショートカット', 'm.help': 'ヘルプとヒント', 'm.about': 'Auorisについて', 'm.data': 'データフォルダを開く', 'm.profile': 'プロフィールを編集',
  today: '今日', yesterday: '昨日', week: '過去7日間', month: '過去30日間', older: 'それ以前', noChats: 'まだチャットはありません。', noMatch: '見つかりません。',
  sugg: ['ダウンロードフォルダの中身をまとめて', '写真を日付でリネームするPythonスクリプトを作って', '今のフォルダの中身を説明して'],
  suggChat: ['ニューラルネットの学習を簡単に説明して', '友達へのメッセージを手伝って', 'プログラミング学習向けの作品アイデアを5つ'] },
zh: { newChat: '新对话', explore: '探索', routines: '例行任务', searchChats: '搜索对话', chat: '聊天', code: '代码', deepThink: '深度思考',
  'effort.low': '投入：低', 'effort.medium': '投入：中', 'effort.high': '投入：高', 'effort.max': '投入：最大', 'effort.minimal': '投入：最低', 'effort.vibing': '投入：Vibing ✦',
  'perm.ask': '更改前询问', 'perm.edits': '自动接受编辑', 'perm.ai': 'AI 决定（不确定时询问）', 'perm.all': '全部自动接受',
  incognito: '无痕', hideSidebar: '隐藏侧边栏 (Ctrl+B)', settings: '设置', usage: '用量', save: '保存', cancel: '取消',
  's.profile': '个人资料', 's.general': '通用', 's.appearance': '外观', 's.model': '模型', 's.privacy': '隐私与数据', 's.localOnly': '仅保存在这台电脑上。',
  's.name': '显示名称', 's.color': '头像颜色', 's.callMe': 'Auoris 应该怎么称呼你？', 's.callMePh': '（默认为显示名称）',
  's.instr': 'Auoris 应该了解你什么？（每次对话都会附加）', 's.instrPh': '例如：我主要用 Java 写 Minecraft 插件。',
  's.uiLang': '应用语言', 's.replyLang': 'AI 回复语言', 's.sendKey': '发送方式', 's.enter': 'Enter（Shift+Enter 换行）', 's.ctrlEnter': 'Ctrl+Enter（Enter 换行）',
  's.startup': '登录 Windows 时启动 Auoris', 's.startupHint': '仅限 .exe 版本', 's.accent': '强调色', 's.textSize': '文字大小',
  's.small': '小', 's.default': '默认', 's.large': '大', 's.xl': '特大', 's.calm': '减少动画', 's.calmHint': '关闭滑动/淡入效果',
  's.stats': '显示 token 统计', 's.statsHint': '回复下方的 token 数和上下文指示', 's.modelName': 'Ollama 模型', 's.maxCtx': '最大上下文 (num_ctx)', 's.temp': '温度（留空=默认）',
  's.autoCtx': '自动上下文', 's.autoCtxHint': '从小开始按需增长 — 大幅节省显存', 's.idle': '空闲时释放显存（多久后卸载）',
  's.never': '从不', 's.findModels': '在"探索"中找更多模型 →', 's.hideUser': '隐藏我的用户名',
  's.hideUserHint': '屏幕上显示为 C:\\Users\\*****\\（AI 仍使用真实路径）', 's.incog': '无痕对话', 's.incogHint': '使用顶部的无痕按钮 — 这些对话不会保存。',
  's.dataFolder': '你的数据', 's.openFolder': '打开文件夹', 's.clearUsage': '清除用量统计', 's.clearUsageHint': '重置 token 计数。', 's.clear': '清除',
  's.clearChats': '删除所有对话', 's.clearChatsHint': '永久删除全部聊天记录。', 's.deleteAll': '全部删除',
  'ex.title': '探索模型', 'ex.sub': '在 Hugging Face 搜索 GGUF 模型并用 Ollama 运行。', 'ex.search': '搜索模型 — 如 qwen coder、llama 3、vision...', 'ex.installed': '已安装',
  'rt.sub': '自动运行的提示词 — 每次运行都会成为一个对话。', 'rt.new': '新建例行任务',
  ph: '随便问，提到一个文件夹，或告诉它要构建什么...', phChat: '给 Auoris 发消息...', phBusy: '输入后续消息 — 将在当前步骤结束后发送...',
  footEnter: 'Enter 发送 · Shift+Enter 换行 · / 命令', footCtrl: 'Ctrl+Enter 发送 · Enter 换行 · / 命令',
  emptyCode: '我们要构建什么？', emptyCodeSub: '读取文件、编写代码、运行命令并在这台电脑上构建项目。',
  emptyChat: '有什么可以帮你{name}？', emptyChatSub: '聊天模式 — 只是对话。处理文件请切换到"代码"。',
  incogBanner: '🕶 无痕 — 此对话不会被保存', autoLang: '与我书写的语言相同',
  'm.lang': '语言', 'm.keys': '键盘快捷键', 'm.help': '帮助与技巧', 'm.about': '关于 Auoris', 'm.data': '打开数据文件夹', 'm.profile': '编辑资料',
  today: '今天', yesterday: '昨天', week: '过去 7 天', month: '过去 30 天', older: '更早', noChats: '还没有对话。', noMatch: '没有匹配项。',
  sugg: ['看看我的下载文件夹并总结内容', '写一个按日期重命名照片的 Python 脚本', '解释当前工作文件夹里有什么'],
  suggChat: ['简单解释神经网络如何学习', '帮我给朋友写条消息', '给我 5 个学编程的项目点子'] },
};
let LANG = 'en';
function t(k) { return (I18N[LANG] && I18N[LANG][k]) ?? I18N.en[k] ?? k; }
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  $('footHint').textContent = t(prefs.send_key === 'ctrl' ? 'footCtrl' : 'footEnter');
  input.placeholder = busy ? t('phBusy') : t(mode === 'chat' ? 'phChat' : 'ph');
  $('replyLang').innerHTML = `<option value="auto">${esc(t('autoLang'))}</option>` + REPLY_LANGS.map(l => `<option>${l}</option>`).join('');
  $('replyLang').value = prefs.reply_lang || 'auto';
  if ($('empty')) showEmpty();
  drawChats();
}

// ================================================================ prefs, profile, modes, incognito
let prefs = {}, mode = 'code', incognito = false;
const ACCENTS = { blue: ['#7fb4ff', '#5b9dff', '#141d33', '#2b4680'], purple: ['#b69cff', '#9a7bff', '#1d1733', '#4a3a80'],
  green: ['#6ee7a0', '#3ccf7e', '#12261d', '#28573f'], orange: ['#ffb46b', '#ff9a3d', '#2a1d12', '#6b4424'],
  pink: ['#ff8fc8', '#ff66b3', '#2b1522', '#6b2f52'], red: ['#ff8a8a', '#ff6b6b', '#2a1a1b', '#5a2b2d'], teal: ['#5fe0d4', '#2cc7b8', '#10262a', '#23565a'],
  cyan: ['#67d8f5', '#2ec4ea', '#0f2329', '#235a69'], indigo: ['#9aa5ff', '#7c88ff', '#171a33', '#3a4180'], gold: ['#ffd166', '#f4b93a', '#2a2210', '#6b5320'],
  lime: ['#b5e86b', '#93d63c', '#1c2612', '#47652a'], coral: ['#ff9e85', '#ff7f61', '#2b1914', '#6e3a2d'], silver: ['#d6dae3', '#b3b9c6', '#1f2228', '#4a4f5a'] };
const AVATAR_COLORS = ['#5b9dff', '#9a7bff', '#3ccf7e', '#ff9a3d', '#ff66b3', '#e5484d', '#2cc7b8', '#8b93a7'];
const BANNERS = ['', 'linear-gradient(135deg,#1c3a8f,#7fb4ff)', 'linear-gradient(135deg,#3a1c71,#d76d77,#ffaf7b)', 'linear-gradient(135deg,#0f2027,#2c5364)',
  'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#ff512f,#dd2476)', 'linear-gradient(135deg,#232526,#414345)',
  'radial-gradient(circle at 30% 20%,#b36bff,#1d1733 70%)', 'linear-gradient(135deg,#f7971e,#ffd200)'];
const NAME_FX = [['none', 'None'], ['gradient', 'Gradient'], ['rainbow', '🌈 Rainbow'], ['glow', '✨ Glow'], ['fire', '🔥 Fire'], ['neon', '💡 Neon'], ['shimmer', '🪩 Shimmer'], ['wave', '🌊 Wave']];
const AV_DECO = [['none', 'None'], ['glow', 'Glow ring'], ['rainbow', '🌈 Rainbow ring'], ['pulse', 'Pulse'], ['orbit', '☄ Orbiting asteroid'], ['moon', '🌙 Moon ring']];
const PROF_FX = [['none', 'None'], ['sparkles', '✦ Sparkles'], ['snow', '❄ Snow'], ['stars', '⭐ Stars'], ['hearts', '♥ Hearts'], ['confetti', '🎉 Confetti'], ['aurora', '🌌 Aurora']];
let media = { avatar: null, banner: null, v: 0 };
function applyMediaVars() {
  const r = document.documentElement.style;
  r.setProperty('--avimg', media.avatar ? `url(${media.avatar})` : 'none');
  r.setProperty('--banimg', media.banner ? `url(${media.banner})` : 'none');
}
const GUEST_SVG = '<svg viewBox="0 0 24 24" class="guestpic"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/></svg>';
function paintAvatar(el, p = prefs) {
  const name = (p.profile_name || 'User').trim() || 'User';
  const guest = !media.avatar && name.toLowerCase() === 'user' && !p.call_me;
  el.className = el.className.split(' ').filter(c => !/^adeco-|^img$/.test(c)).join(' ');
  el.style.setProperty('--pc', p.profile_color || '#5b9dff');
  if (media.avatar) { el.classList.add('img'); el.style.backgroundImage = 'var(--avimg)'; el.textContent = ''; }
  else if (guest) { el.style.backgroundImage = ''; el.innerHTML = GUEST_SVG; }
  else { el.style.backgroundImage = ''; el.textContent = [...name][0].toUpperCase(); }
  if (p.avatar_deco && p.avatar_deco !== 'none') el.classList.add('adeco-' + p.avatar_deco);
}
function nameHTML(name, fx) {
  name = (name || 'You').trim() || 'You';
  if (fx === 'wave') return `<span class="nfx-wave">${[...name].map((ch, i) => `<i style="animation-delay:${i * 0.07}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('')}</span>`;
  return `<span class="nfx-${esc(fx || 'none')}">${esc(name)}</span>`;
}
function profileCard(p, small) {
  const ban = media.banner ? 'background-image:var(--banimg)' : `background:${esc(p.banner_color || '') || `linear-gradient(135deg, ${p.profile_color || '#5b9dff'}, #1d2331)`}`;
  const sub = small ? esc((p.model || '').split('/').pop().replace(/-GGUF.*$|:.*$/i, '')) : 'Auoris · ' + esc(t('s.localOnly'));
  // This card always shows the signed-in user themselves (own profile menu / settings preview), so the
  // Owner/Admin/Moderator/Plus badge comes from the account (myProfile), not the local `p` (prefs) object -
  // same badgesFor() used for other people's profile popups, just inline next to the name here.
  const own = (typeof myProfile !== 'undefined' && myProfile) ? myProfile : null;
  const badgeHTML = own ? badgesFor(own).map(b => badgeHtml(b, 18)).join('') : '';
  return `<div class="pcard ${small ? 'sm' : ''}"><div class="pban" style="${ban}"></div><div class="pfx"></div>
    <span class="pav"><span class="avatar ${small ? 'big' : 'xl'}"></span>${(typeof me !== 'undefined' && me && typeof STATUS_INFO !== 'undefined' && typeof myStatus === 'function') ? `<span class="pdot" style="--sc:${STATUS_INFO[myStatus()][1]}"></span>` : ''}</span>
    <div class="pbody"><div class="pn">${nameHTML(p.profile_name, p.name_effect)}${badgeHTML}</div>${p.bio ? `<div class="pbio">${esc(p.bio)}</div>` : ''}<div class="pmeta">${sub}</div></div></div>`;
}
function hydrateCard(card, p = prefs) {
  if (!card) return;
  paintAvatar(card.querySelector('.avatar'), p);
  const fx = card.querySelector('.pfx'), kind = p.profile_effect || 'none';
  fx.className = 'pfx ' + kind; fx.innerHTML = '';
  const n = { snow: 26, confetti: 26, stars: 22, sparkles: 12, hearts: 12 }[kind] || 0;
  const colors = ['#ff5f6d', '#ffc371', '#47e891', '#3fb8ff', '#b36bff', '#ff66b3'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i'), r = Math.random;
    d.style.cssText = `left:${r() * 100}%;top:${kind === 'stars' || kind === 'sparkles' ? r() * 90 + '%' : ''};--s:${(kind === 'snow' ? 2 + r() * 3 : 2 + r() * 3).toFixed(1)}px;` +
      `--d:${(kind === 'snow' ? 4 + r() * 5 : kind === 'confetti' ? 2.5 + r() * 2.5 : 1.6 + r() * 2.4).toFixed(2)}s;--dl:${(-r() * 6).toFixed(2)}s;--dx:${((r() - .5) * 60).toFixed(0)}px;--c:${colors[i % colors.length]}`;
    fx.appendChild(d);
  }
}
async function ramStatusShow() {
  $('ramPctIn').oninput = () => { $('ramPctOut').textContent = $('ramPctIn').value + '%'; };
  $('ramNowBtn').onclick = async () => {   // the same clean-up as the automatic one, right now (the switch above doesn't need to be on)
    const b = $('ramNowBtn'); b.disabled = true; b.textContent = 'Optimizing…';
    try { await api().ram_clean_now(); } catch (e) {}
    b.disabled = false; b.textContent = 'Optimize now'; ramStatusShow();
  };
  let st = null; try { st = await api().ram_status(); } catch (e) {}
  if (!st || st.load == null) { $('ramStatus').textContent = ''; return; }
  let txt = 'Memory in use now: ' + st.load + '% of ' + Math.round(st.total_mb / 1024) + ' GB.';
  if (st.last) txt += ' Last clean-up ' + new Date(st.last.at * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) + ': ' + (st.last.freed_mb >= 1024 ? (st.last.freed_mb / 1024).toFixed(1) + ' GB' : st.last.freed_mb + ' MB') + ' freed.';
  $('ramStatus').textContent = txt;
}
function applyPrefs() {
  applyMediaVars();
  updateModelChip();
  const a = ACCENTS[prefs.accent] || ACCENTS.blue, r = document.documentElement.style;
  r.setProperty('--acc', a[0]); r.setProperty('--acc2', a[1]); r.setProperty('--accbg', a[2]); r.setProperty('--accline', a[3]);
  document.body.style.zoom = prefs.font_scale || 1;
  document.body.classList.toggle('calm', !!prefs.calm);
  document.body.classList.toggle('nostats', prefs.show_stats === false);
  paintAvatar($('profAvatar'));
  document.querySelectorAll('.avatar.me').forEach(el => paintAvatar(el));
  $('profNameTxt').innerHTML = nameHTML(prefs.profile_name, prefs.name_effect);
  LANG = I18N[prefs.ui_lang] ? prefs.ui_lang : 'en';
  applyI18n();
}
function setModeUI(m) {
  mode = m === 'chat' ? 'chat' : 'code';
  document.body.classList.toggle('mode-chat', mode === 'chat');
  $('modeSeg').dataset.mode = mode;
  $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  input.placeholder = busy ? t('phBusy') : t(mode === 'chat' ? 'phChat' : 'ph');
}
$('modeSeg').querySelectorAll('button').forEach(b => b.onclick = async () => {
  if (b.dataset.mode === mode && view === 'chat') { if (pendingMode) { pendingMode = null; toast('Switch cancelled', 'Staying in ' + (mode === 'code' ? 'Code' : 'Chat') + '.'); } return; }
  if (busy) {
    if (String(prefs.model || '').startsWith('cloud/')) {   // a cloud reply is only a stream: switch as soon as it finishes
      if (pendingMode !== b.dataset.mode) { pendingMode = b.dataset.mode; toast('Switching to ' + (pendingMode === 'code' ? 'Code' : 'Chat'), 'Right after this reply finishes.'); }
    } else if (!busyToastAt || Date.now() - busyToastAt > 3000) { busyToastAt = Date.now(); toast('Busy', 'Wait for the current reply to finish first.'); }
    return;
  }
  const id = await api().new_chat(b.dataset.mode, incognito);
  if (id === false) return;
  setModeUI(b.dataset.mode); chatId = id; showView('chat'); showEmpty(); renderAtts([]); renderQueue([]); drawChats();
});
function setIncognitoUI(on) { incognito = !!on; document.body.classList.toggle('incognito', incognito); if ($('empty')) showEmpty(); }
$('incogBtn').onclick = async () => {
  if (busy) { toast('Busy', 'Wait for the current reply to finish first.'); return; }
  const id = await api().new_chat(mode, !incognito);
  if (id === false) return;
  setIncognitoUI(!incognito); chatId = id; showView('chat'); showEmpty(); renderAtts([]); renderQueue([]); drawChats();
  toast(incognito ? '🕶 Incognito on' : 'Incognito off', incognito ? 'Chats won’t be saved until you turn it off.' : 'New chats are saved again.');
};
$('collapseBtn').onclick = () => toggleSide();

// ---- profile menu
function closeMenus() { document.querySelectorAll('.pmenu').forEach(m => m.id === 'profMenu' ? (m.hidden = true) : m.remove()); $('profBtn').classList.remove('open'); }
function openProfileMenu() {
  const m = $('profMenu'), b = $('profBtn').getBoundingClientRect(), z = prefs.font_scale || 1;
  const name = prefs.profile_name || 'You';
  m.innerHTML = `${profileCard(prefs, true)}
    ${me ? `<button class="mi" data-sub="status"><span class="i"><span style="color:${STATUS_INFO[myStatus()][1]}">●</span></span>${esc(STATUS_INFO[myStatus()][0])}${prefs.status_text ? '<small style="margin-left:6px;opacity:.6">' + esc(prefs.status_text) + '</small>' : ''}<span class="arr">›</span></button>` : ''}
    <button class="mi" data-a="profile"><span class="i">👤</span>${esc(t('m.profile'))}</button>
    <button class="mi" data-a="account"><span class="i">🔐</span>Account &amp; security</button>
    <button class="mi" data-a="settings"><span class="i">⚙</span>${esc(t('settings'))}<kbd>Ctrl+,</kbd></button>
    <div class="sep2"></div>
    <button class="mi" data-a="usage"><span class="i">📊</span>${esc(t('usage'))}</button>
    <button class="mi" data-a="phone"><span class="i">📱</span>Phone app</button>
    <button class="mi" data-sub="chats"><span class="i">💬</span>Chats<span class="arr">›</span></button>
    <button class="mi" data-sub="help"><span class="i">❔</span>Help &amp; about<span class="arr">›</span></button>
    <button class="mi" data-a="lang"><span class="i">🌐</span>${esc(t('m.lang'))}<span class="arr">${esc(LANGS[LANG])} ›</span></button>
    <div class="sep2"></div>
    <button class="mi" data-a="data"><span class="i">📁</span>${esc(t('m.data'))}</button>
    <button class="mi" data-a="update"><span class="i">⟳</span>Check for updates<span class="arr">v${esc(prefs.version || '')}</span></button>
    ${myProfile && (myProfile.is_admin || myProfile.is_mod || myProfile.is_tester || myProfile.is_developer) ? `<button class="mi" data-a="beta"><span class="i">🧪</span>Beta access<span class="arr">${prefs.beta_channel ? 'On' : 'Off'}</span></button>` : ''}${myProfile && (myProfile.is_admin || myProfile.is_developer) ? `<button class="mi" data-a="dev"><span class="i">🛠️</span>Dev builds<span class="arr">${prefs.dev_channel ? 'On' : 'Off'}</span></button>` : ''}`;
  m.hidden = false; $('profBtn').classList.add('open');
  hydrateCard(m.querySelector('.pcard'));
  m.querySelector('.pcard').style.cursor = 'pointer';
  m.querySelector('.pcard').onclick = e => { e.stopPropagation(); closeMenus(); openSettings('profile'); };
  m.style.left = (b.left / z + 4) + 'px'; m.style.bottom = (innerHeight / z - b.top / z + 6) + 'px'; m.style.top = 'auto';
  m.querySelectorAll('.mi').forEach(it => {
    it.onclick = e => { e.stopPropagation(); if (it.dataset.sub) openSubMenu(it, it.dataset.sub); else menuAction(it.dataset.a, it); };
    if (it.dataset.a === 'lang') it.onmouseenter = () => openLangMenu(it);
    else if (it.dataset.sub) it.onmouseenter = () => openSubMenu(it, it.dataset.sub);
    else it.onmouseenter = () => document.querySelectorAll('.pmenu.sub').forEach(x => x.remove());
  });
}
function pmSubs() {
  return {
    chats: [['xexport', '⤓', 'Export chats…'], ['ximport', '⤒', 'Import chats…'], ['stars', '★', 'Starred messages']],
    status: [['st:online', '<span style="color:#43d17a">●</span>', 'Online'], ['st:idle', '<span style="color:#f2b844">●</span>', 'Idle'], ['st:dnd', '<span style="color:#ef5350">●</span>', 'Do not disturb'], ['st:offline', '<span style="color:#6b7280">●</span>', 'Offline (appear offline)'], ['st:text', '✎', prefs.status_text ? 'Edit custom status…' : 'Set a custom status…']],
    help: [['keys', '⌨', t('m.keys'), 'Ctrl+/'], ['help', '❔', t('m.help')], ['tour', '🧭', 'Take the tour'], ['about', '🌙', t('m.about')]],
  };
}
function openSubMenu(anchor, which) {
  document.querySelectorAll('.pmenu.sub').forEach(x => x.remove());
  const items = pmSubs()[which]; if (!items) return;
  const r = anchor.getBoundingClientRect(), z = prefs.font_scale || 1;
  const s = document.createElement('div'); s.className = 'pmenu sub';
  s.innerHTML = items.map(([a, ic, label, kbd]) => `<button class="mi" data-a="${a}"><span class="i">${ic}</span>${esc(label)}${kbd ? `<kbd>${esc(kbd)}</kbd>` : ''}</button>`).join('');
  document.body.appendChild(s);
  s.style.left = (r.right / z + 6) + 'px'; s.style.top = Math.max(8, Math.min(r.top / z - 8, innerHeight / z - s.offsetHeight - 8)) + 'px';
  s.querySelectorAll('.mi').forEach(it => it.onclick = e => { e.stopPropagation(); menuAction(it.dataset.a, it); });
}
function openLangMenu(anchor) {
  document.querySelectorAll('.pmenu.sub').forEach(x => x.remove());
  const r = anchor.getBoundingClientRect(), z = prefs.font_scale || 1;
  const s = document.createElement('div'); s.className = 'pmenu sub';
  s.innerHTML = Object.entries(LANGS).map(([k, v]) => `<button class="mi ${k === LANG ? 'cur' : ''}" data-l="${k}">${esc(v)}</button>`).join('');
  document.body.appendChild(s);
  s.style.left = (r.right / z + 6) + 'px'; s.style.top = Math.max(8, Math.min(r.top / z - 40, innerHeight / z - s.offsetHeight - 8)) + 'px';
  s.querySelectorAll('.mi').forEach(it => it.onclick = async e => { e.stopPropagation(); prefs.ui_lang = it.dataset.l; await api().set_setting('ui_lang', it.dataset.l); applyPrefs(); closeMenus(); });
}
function menuAction(a, el) {
  if (a === 'lang') { openLangMenu(el); return; }
  closeMenus();
  if (a && a.startsWith('st:')) { statusAction(a.slice(3)); return; }
  if (a === 'profile') openSettings('profile');
  else if (a === 'settings') openSettings('general');
  else if (a === 'usage') openUsage();
  else if (a === 'xexport') xExportDlg();
  else if (a === 'ximport') xImportDlg();
  else if (a === 'keys') showKeys();
  else if (a === 'help') showHelp();
  else if (a === 'tour') startTour();
  else if (a === 'stars') showStars();
  else if (a === 'data') api().open_data_folder();
  else if (a === 'account' || a === 'phone') openAccount(a);
  else if (a === 'about') showAbout();
  else if (a === 'update') checkForUpdates().then(r => {
    if (r.status === 'beta') return;   // the beta install announces itself
    if (r.status === 'current') toast('You\'re up to date', `Auoris ${prefs.version} is the latest version.`);
    else if (r.status === 'not_configured') toast('Updates', 'The update server isn\'t set up yet.');
    else if (r.status === 'error') toast('Couldn\'t check for updates', r.error);
  });
  else if (a === 'beta') {
    const on = !prefs.beta_channel;
    api().set_beta_channel(on).then(async r => {
      prefs.beta_channel = on;
      if (on) {
        toast('🧪 Beta access on', 'Check for updates now installs the latest beta (or the newest stable, if that is newer).');
        betaCheck(true);
      } else if (/-/.test(String(prefs.version))) {
        // running a beta build: go back to the real release (the updater installs the latest stable even though its number is lower)
        toast('Beta access off', 'Going back to the latest stable release…');
        const u = await api().check_updates();
        if (u && u.status === 'error') toast('Couldn\'t go back to stable', u.error);
      } else toast('Beta access off', 'Back to stable releases only.');
    });
  }
  else if (a === 'dev') {
    const on = !prefs.dev_channel;
    api().set_dev_channel(on).then(async r => {
      prefs.dev_channel = on;
      if (on) {
        toast('🛠️ Dev builds on', 'Check for updates now installs the latest private dev build (with the Dev access features).');
        betaCheck(true);
      } else if (prefs.dev_build) {
        toast('Dev builds off', 'Going back to the latest stable release…');
        const u = await api().check_updates();
        if (u && u.status === 'error') toast('Couldn\'t go back to stable', u.error);
      } else toast('Dev builds off', 'Back to normal updates.');
    });
  }
}
// "Check for updates": with beta access on it looks for a newer private beta first, then for a newer stable release
// (a stable release newer than the beta wins, because it is the real thing).
async function checkForUpdates() {
  if ((prefs.beta_channel || prefs.dev_channel) && await betaCheck(true, true) === 'installing') return { status: 'beta' };
  return api().check_updates();
}
// Private beta builds: only staff, Testers and Developers (dev builds: admins and Developers) get an answer from the beta-update Edge Function
// (checked on the server, not here).
// With Dev builds on it asks for the dev channel instead: the same kind of private build, with the dev-only features.
// Returns 'installing' when it started installing a beta. `combined`: part of "Check for updates", so it stays quiet when there is none.
async function betaCheck(manual, combined) {
  const dev = !!prefs.dev_channel, what = dev ? 'Dev builds' : 'Beta access';
  const say = t => { if (manual && !combined) toast(what, t); };
  try {
    if (!me || !(prefs.beta_channel || dev)) return '';
    const { data, error } = await sb.functions.invoke('beta-update', { body: dev ? { channel: 'dev' } : {} });
    if (error || !data) { say(dev ? 'Dev builds are only available to Developers.' : 'Beta builds are only available to Testers and Developers.'); return ''; }
    if (!data.version) { say('No ' + (dev ? 'dev' : 'beta') + ' build is published right now.'); return ''; }
    if (!/^\d+\.\d+\.\d+(?:-\d+\.\d+)?$/.test(String(data.version))) { say('The beta channel answered with an unreadable version.'); return ''; }
    // Parse the whole version including a beta suffix: "1.7.17-1.2" must compare as newer than "1.7.17",
    // otherwise the beta channel never offers anything after the first suffixed build.
    const v = x => { const m = String(x).match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+)\.(\d+))?$/); return m ? [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)] : [0, 0, 0, 0, 0]; };
    const a = v(data.version), b = v(prefs.version);
    let newer = 0;
    for (let i = 0; i < 5 && !newer; i++) newer = (a[i] || 0) - (b[i] || 0);
    if (newer <= 0) { say('You already have the latest ' + (dev ? 'dev build.' : 'beta.')); return ''; }
    const r = await api().beta_install({ version: data.version, url: data.url, sha256: data.sha256, sig: data.sig, notes: data.notes, size: data.size });
    if (r && r.status === 'available') { toast((dev ? 'Dev' : 'Beta') + ' build available', `v${data.version} - installing…`); return 'installing'; }
    if (r && r.status === 'error') toast(what, r.error);
  } catch (e) { /* offline or signed out: try again at the next check */ }
  return '';
}
setInterval(() => { try { betaCheck(false); } catch (e) {} }, 6 * 3600e3);
$('profBtn').onclick = e => { e.stopPropagation(); $('profMenu').hidden ? openProfileMenu() : closeMenus(); };
document.addEventListener('click', e => { if (!e.target.closest('.pmenu') && !e.target.closest('#profBtn')) closeMenus(); });
function helpDialog(title, html) { $('helpTitle').textContent = title; $('helpBody').innerHTML = html; $('helpDlg').showModal(); }
$('helpClose').onclick = () => $('helpDlg').close();
$('helpDlg').onclick = e => { if (outside($('helpDlg'), e)) $('helpDlg').close(); };
function showKeys() {
  const K = [['Ctrl+N', t('newChat')], ['Ctrl+Shift+N', t('incognito')], ['Ctrl+B', t('hideSidebar').replace(/\s*\(.*\)/, '')], ['Ctrl+,', t('settings')],
    ['Ctrl+K', 'Command palette'], ['Ctrl+Shift+K', t('searchChats')], ['Ctrl+Shift+F', 'Search messages'], ['Ctrl+E', t('explore')], ['Ctrl+/', t('m.keys')], ['Ctrl+?', 'Important commands'], ['/', 'Commands'], ['Esc', 'Stop'],
    [prefs.send_key === 'ctrl' ? 'Ctrl+Enter' : 'Enter', 'Send'], ['↑ / ↓ · Tab', 'Pick a / command']];
  helpDialog(t('m.keys'), K.map(([k, v]) => `<div class="kbrow"><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join(''));
}
function showHelp() {
  helpDialog(t('m.help'), `
    <div class="helpsec"><b>💬 Chat vs ⌘ Code</b><div>Chat is a normal conversation (no file access, faster). Code lets the AI read your files, edit code, run commands and build projects in the working folder.</div></div>
    <div class="helpsec"><b>🔒 Permissions</b><div>In Code mode choose whether it asks before changes, auto-accepts edits, lets the AI decide (with built-in safety rules), or accepts everything.</div></div>
    <div class="helpsec"><b>✦ Deep think & effort</b><div>Deep think makes it reason first. Effort sets how thorough it is and how many steps it can take.</div></div>
    <div class="helpsec"><b>⏱ Routines</b><div>Save a prompt and a schedule — it runs by itself while Auoris is open.</div></div>
    <div class="helpsec"><b>🧭 Explore</b><div>Find and download GGUF models from Hugging Face. Green "Fits your GPU" ones run fastest.</div></div>
    <div class="helpsec"><b>🕶 Incognito</b><div>Chats started in incognito are never written to disk.</div></div>
    <div class="helpsec"><b>⚡ Tips</b><div>Type <b>/</b> for commands · drop or paste images/files into the chat · type while it works to queue a follow-up.</div></div>`);
}
function showAbout() {
  helpDialog('Auoris', `<div style="text-align:center;padding:6px 0 4px"><svg width="96" height="96"><use href="#logo"/></svg>
    <div class="pname" style="font-size:20px;font-weight:700;margin-top:6px">Auoris ${esc(prefs.version || '')}</div>
    <div class="vsub" style="margin:6px auto 14px">A local AI workshop — everything runs on your PC through Ollama.<br>Model: ${esc(prefs.model || '')}</div></div>`);
}

// ---- tabbed settings
let setDraft = {};
function openSettings(tab) {
  setDraft = { profile_color: prefs.profile_color, accent: prefs.accent, font_scale: prefs.font_scale || 1, banner_color: prefs.banner_color || '',
               name_effect: prefs.name_effect || 'none', avatar_deco: prefs.avatar_deco || 'none', profile_effect: prefs.profile_effect || 'none' };
  linkedRender(); creatorRender();
  $('profName').value = prefs.profile_name || ''; $('callMe').value = prefs.call_me || ''; $('profBio').value = prefs.bio || ''; $('profPron').value = prefs.pronouns || '';
  $('instrIn').value = prefs.custom_instructions || '';
  $('uiLang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); $('uiLang').value = LANG;
  $('replyLang').value = prefs.reply_lang || 'auto'; $('sendKey').value = prefs.send_key || 'enter'; $('startupIn').checked = !!prefs.start_with_windows;
  $('linkOpen').value = ['ask', 'default'].includes(prefs.link_open || 'ask') ? (prefs.link_open || 'ask') : 'auoris'; $('searchEng').value = prefs.search_engine || 'duckduckgo';
  $('bwHomeIn').value = prefs.browser_home || ''; $('proxyUrl').value = prefs.proxy_url || ''; $('proxyOn').checked = !!prefs.proxy_enabled;
  $('proxyRes').className = 'vsub'; $('proxyRes').textContent = 'Supports HTTP, HTTPS and SOCKS4/5. Usernames/passwords work with HTTP proxies (Chromium can’t do SOCKS logins).';
  $('ramOptIn').checked = !!prefs.ram_opt; $('ramPctIn').value = prefs.ram_opt_pct || 80; $('ramPctOut').textContent = $('ramPctIn').value + '%'; ramStatusShow();
  $('boostIn').checked = !!prefs.game_boost; $('calmIn').checked = !!prefs.calm; $('statsIn').checked = prefs.show_stats !== false; $('autoUpdIn').checked = prefs.auto_update !== false; $('micAccessIn').checked = prefs.mic_access === 'allow';
  $('notifDmsIn').checked = prefs.notif_dms !== false; $('notifMentionsIn').checked = prefs.notif_mentions !== false; $('notifGroupsIn').checked = !!prefs.notif_groups;
  $('sfxVolIn').value = prefs.sfx_volume == null ? 60 : prefs.sfx_volume; $('sfxVolLbl').textContent = $('sfxVolIn').value + '%';
  xSettingsOpen();
  $('updInfo').textContent = updLatest ? `v${updLatest.version} is available (you have v${prefs.version}).` : `Version ${prefs.version}` + (prefs.can_update ? ' · updates from GitHub' : ' · not installed with Setup, so it can\'t self-update');
  $('modelIn').value = prefs.model || ''; $('ctxIn').value = prefs.num_ctx || 131072; $('tempIn').value = prefs.temperature ?? '';
  $('autoCtxIn').checked = prefs.auto_ctx !== false; $('autoCompactIn').checked = prefs.auto_compact !== false; $('compactTokIn').value = String(prefs.compact_tokens || 700000); $('idleIn').value = String(prefs.idle_unload_min ?? 15); $('hideUserIn').checked = !!prefs.hide_username;
  $('dataDir').textContent = prefs.data_dir || ''; $('verTxt').textContent = 'Auoris ' + (prefs.version || '');
  drawSwatches(); setTab(tab || 'profile');
  renderSocialPrivacy();
  api().list_models().then(ms => $('modelList').innerHTML = ms.map(m => `<option value="${esc(m)}">`).join(''));
  $('settings').showModal();
}
function setTab(tab) {
  document.querySelectorAll('.settabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.setbody [data-pane]').forEach(p => p.hidden = p.dataset.pane !== tab);
}
document.querySelectorAll('.settabs [data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function drawSwatches() {
  $('profColors').innerHTML = AVATAR_COLORS.map(c => `<button class="sw ${c === setDraft.profile_color ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
  $('profColors').querySelectorAll('.sw').forEach(s => s.onclick = () => { setDraft.profile_color = s.dataset.c; drawSwatches(); });
  $('bannerColors').innerHTML = BANNERS.map((b, i) => `<button class="sw ${b === setDraft.banner_color ? 'on' : ''}" style="background:${b || 'linear-gradient(135deg,' + (setDraft.profile_color || '#5b9dff') + ',#1d2331)'}" data-i="${i}" title="${b ? '' : 'Match avatar color'}"></button>`).join('');
  $('bannerColors').querySelectorAll('.sw').forEach(s => s.onclick = () => { setDraft.banner_color = BANNERS[+s.dataset.i]; drawSwatches(); });
  const chips = (id, list, key) => {
    $(id).innerHTML = list.map(([v, label]) => `<button class="${setDraft[key] === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('');
    $(id).querySelectorAll('button').forEach(b => b.onclick = () => { setDraft[key] = b.dataset.v; drawSwatches(); });
  };
  chips('nameFx', NAME_FX, 'name_effect'); chips('avDeco', AV_DECO, 'avatar_deco'); chips('profFx', PROF_FX, 'profile_effect');
  drawCardPreview();
  $('accentColors').innerHTML = Object.entries(ACCENTS).map(([k, v]) => `<button class="sw ${k === setDraft.accent ? 'on' : ''}" style="background:${v[1]}" data-a="${k}" title="${k}"></button>`).join('');
  $('accentColors').querySelectorAll('.sw').forEach(s => s.onclick = () => { setDraft.accent = s.dataset.a; drawSwatches(); });
  $('fontSeg').querySelectorAll('button').forEach(b => { b.classList.toggle('on', +b.dataset.v === +setDraft.font_scale); b.onclick = () => { setDraft.font_scale = +b.dataset.v; drawSwatches(); }; });
}
$('profName').oninput = $('profBio').oninput = () => drawCardPreview();
function draftProfile() {
  return { ...prefs, ...setDraft, profile_name: $('profName').value.trim() || 'You', bio: $('profBio').value.trim() };
}
let lastPreviewKey = '';
function drawCardPreview() {
  const p = draftProfile();
  const key = JSON.stringify([p.profile_name, p.bio, p.profile_color, p.banner_color, p.name_effect, p.avatar_deco, p.profile_effect, !!media.avatar, !!media.banner, media.v]);
  if (key === lastPreviewKey) return;  // don't restart the animations on every keystroke-free redraw
  lastPreviewKey = key;
  $('profCardPreview').innerHTML = profileCard(p, false);
  hydrateCard($('profCardPreview').querySelector('.pcard'), p);
}
// Picking an image always keeps working locally (offline / signed-out use, same as before uploads existed).
// When signed in, the same picked file is also pushed to the 'avatars' Storage bucket and the column on
// `profiles` is updated, so friends and the website can see the real image instead of just the initial letter.
// The cropper for profile pictures (a movable circle over the photo) and banners (a movable 3:1 frame). The photo can be zoomed (slider or
// wheel) and dragged; the circle / frame is dragged to choose what is kept. Resolves {b64, ext} for the cropped image, or null when cancelled.
function cropImage(pick, o) {
  return new Promise(resolve => {
    const dlg = $('cropDlg'), cv = $('cropCv'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, circle = o.shape === 'circle', asp = o.aspect || 1;
    const img = new Image();
    let z = 1, ox = 0, oy = 0, cx = W / 2, cy = H / 2, sw = 100, done = false, drag = null;
    const iw = () => img.naturalWidth, ih = () => img.naturalHeight, s0 = () => Math.min(W / iw(), H / ih()), sc = () => s0() * z;
    const finish = v => { if (done) return; done = true; dlg.removeEventListener('close', onClose); try { dlg.close(); } catch (e) {} resolve(v); };
    const onClose = () => finish(null);
    const view = () => ({ x0: Math.max(0, ox), x1: Math.min(W, ox + iw() * sc()), y0: Math.max(0, oy), y1: Math.min(H, oy + ih() * sc()) });
    const maxW = () => { const v = view(); return Math.min(v.x1 - v.x0, (v.y1 - v.y0) * asp); };
    const clampPan = () => {
      const w = iw() * sc(), h = ih() * sc();
      ox = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, ox));
      oy = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, oy));
    };
    const clampSel = () => {   // the circle / frame always stays on the photo
      const v = view(); sw = Math.min(sw, maxW()); const sh = sw / asp;
      cx = Math.min(v.x1 - sw / 2, Math.max(v.x0 + sw / 2, cx)); cy = Math.min(v.y1 - sh / 2, Math.max(v.y0 + sh / 2, cy));
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, ox, oy, iw() * sc(), ih() * sc());
      const sh = sw / asp, x = cx - sw / 2, y = cy - sh / 2;
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.beginPath(); ctx.rect(0, 0, W, H);
      if (circle) ctx.arc(cx, cy, sw / 2, 0, Math.PI * 2); else ctx.rect(x, y, sw, sh);
      ctx.fill('evenodd'); ctx.restore();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
      if (circle) ctx.arc(cx, cy, sw / 2, 0, Math.PI * 2); else ctx.rect(x, y, sw, sh);
      ctx.stroke();
    };
    const sync = () => { clampPan(); clampSel(); $('cropSize').value = Math.max(0.15, Math.min(1, sw / maxW())); draw(); };
    const zoomAt = (nz, px, py) => {
      nz = Math.min(6, Math.max(1, nz)); const sx = (px - ox) / sc(), sy = (py - oy) / sc();
      z = nz; ox = px - sx * sc(); oy = py - sy * sc(); $('cropZoom').value = z; sync();
    };
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    const inSel = (x, y) => circle ? Math.hypot(x - cx, y - cy) <= sw / 2 : Math.abs(x - cx) <= sw / 2 && Math.abs(y - cy) <= sw / asp / 2;
    cv.onpointerdown = e => { const [x, y] = pt(e); drag = { mode: inSel(x, y) ? 'sel' : 'pan', x, y }; cv.className = drag.mode; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = e => {
      const [x, y] = pt(e);
      if (!drag) { cv.className = inSel(x, y) ? 'sel' : ''; return; }
      if (drag.mode === 'sel') { cx += x - drag.x; cy += y - drag.y; } else { ox += x - drag.x; oy += y - drag.y; }
      drag.x = x; drag.y = y; sync();
    };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.className = ''; };
    cv.onwheel = e => { e.preventDefault(); const [x, y] = pt(e); zoomAt(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), x, y); };
    $('cropZoom').oninput = e => zoomAt(+e.target.value, W / 2, H / 2);
    $('cropSize').oninput = e => { sw = +e.target.value * maxW(); sync(); };
    $('cropX').onclick = $('cropCancel').onclick = () => finish(null);
    $('cropGif').hidden = pick.ext !== 'gif';
    $('cropGif').onclick = () => finish({ b64: pick.b64, ext: pick.ext });
    $('cropOk').onclick = () => {
      const s = sc(), sh = sw / asp, srcW = sw / s;   // the chosen area, in the photo's own pixels
      const outW = Math.round(Math.min(o.maxOut, Math.max(64, srcW))), outH = Math.round(outW / asp);
      const out = document.createElement('canvas'); out.width = outW; out.height = outH;
      const c2 = out.getContext('2d'); c2.imageSmoothingQuality = 'high';
      if (o.format === 'jpeg') { c2.fillStyle = '#10131c'; c2.fillRect(0, 0, outW, outH); }
      c2.drawImage(img, (cx - sw / 2 - ox) / s, (cy - sh / 2 - oy) / s, srcW, sh / s, 0, 0, outW, outH);
      const mime = o.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      out.toBlob(blob => {
        if (!blob) { toast('Crop', "Couldn't crop that image."); return; }
        const fr = new FileReader();
        fr.onload = () => finish({ b64: String(fr.result).split(',')[1], ext: o.format === 'jpeg' ? 'jpg' : 'png' });
        fr.readAsDataURL(blob);
      }, mime, 0.92);
    };
    img.onerror = () => { toast('Crop', "That image couldn't be opened."); finish(null); };
    img.onload = () => {
      $('cropTitle').textContent = o.title; $('cropSizeLbl').textContent = circle ? 'Circle size' : 'Frame size';
      $('cropHint').textContent = circle ? 'Drag the circle to choose your picture. Drag the photo to move it, and zoom with the slider or the mouse wheel.'
                                         : 'Drag the frame to choose your banner. Drag the photo to move it, and zoom with the slider or the mouse wheel.';
      z = 1; $('cropZoom').value = 1; ox = (W - iw() * sc()) / 2; oy = (H - ih() * sc()) / 2; cx = W / 2; cy = H / 2; sw = 0.8 * maxW(); sync();
      dlg.addEventListener('close', onClose); dlg.showModal();
    };
    img.src = `data:${pick.mime};base64,${pick.b64}`;
  });
}
async function uploadMedia(kind) {
  const pick = await api().pick_profile_image(kind);
  if (!pick || pick.cancelled) return;
  if (pick.error) { toast('Couldn\'t use that image', pick.error); return; }
  const cropped = await cropImage(pick, kind === 'avatar' ? { shape: 'circle', aspect: 1, maxOut: 512, format: 'png', title: 'Crop your profile picture' }
                                                          : { shape: 'rect', aspect: 3, maxOut: 1500, format: 'jpeg', title: 'Crop your banner' });
  if (!cropped) return;   // cancelled
  const r = await api().save_profile_image(kind, cropped.b64, cropped.ext);
  if (!r || r.error) { toast('Couldn\'t use that image', (r && r.error) || 'Try another image.'); return; }
  media[kind] = r.url; media.v = (media.v || 0) + 1; lastPreviewKey = ''; drawCardPreview(); applyPrefs();
  if (!me || !sb) return;
  const col = kind === 'avatar' ? 'avatar_url' : 'banner_url';
  if (!r.upload) {
    if (r.cloudTooBig) toast('Profile', `That image is over ${r.cloudTooBig} MB, so it only shows on this PC - it won't sync to your account.`);
    return;
  }
  try {
    const bytes = Uint8Array.from(atob(r.upload.b64), c => c.charCodeAt(0));
    const path = `${me.id}/${kind}.${r.upload.ext}`;
    const { error: upErr } = await sb.storage.from('avatars').upload(path, bytes, { contentType: r.upload.mime, upsert: true });
    if (upErr) { toast('Profile', `Saved locally, but didn\'t sync your ${kind} to your account: ${upErr.message}`); return; }
    const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
    const url = pub.publicUrl + '?v=' + Date.now();  // cache-bust so friends see the new image right away
    const { error: updErr } = await sb.from('profiles').update({ [col]: url }).eq('id', me.id);
    if (updErr) toast('Profile', updErr.message.includes('Plus') ? updErr.message : `Uploaded, but couldn\'t save it to your profile: ${updErr.message}`);
    else myProfile[col] = url;
  } catch (e) { toast('Profile', `Couldn\'t sync your ${kind}: ${e.message || e}`); }
}
// A picture picked on this PC that never reached the account (upload failed, or the account was signed out) is uploaded again once, quietly.
async function resyncProfileMedia() {
  if (!me || !sb || !myProfile) return;
  for (const kind of ['avatar', 'banner']) {
    const col = kind === 'avatar' ? 'avatar_url' : 'banner_url';
    if (myProfile[col]) continue;
    try {
      const up = await api().profile_upload_payload(kind);
      if (!up) continue;
      const bytes = Uint8Array.from(atob(up.b64), c => c.charCodeAt(0));
      const path = `${me.id}/${kind}.${up.ext}`;
      const { error: upErr } = await sb.storage.from('avatars').upload(path, bytes, { contentType: up.mime, upsert: true });
      if (upErr) { console.warn('profile image resync', upErr.message); continue; }
      const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      const { error: updErr } = await sb.from('profiles').update({ [col]: url }).eq('id', me.id);
      if (updErr) console.warn('profile image resync', updErr.message); else myProfile[col] = url;
    } catch (e) { console.warn('profile image resync', e); }
  }
}
async function clearMedia(kind) {
  await api().clear_profile_image(kind);
  media[kind] = null; media.v = (media.v || 0) + 1; lastPreviewKey = ''; drawCardPreview(); applyPrefs();
  if (!me || !sb) return;
  const col = kind === 'avatar' ? 'avatar_url' : 'banner_url';
  const { error } = await sb.from('profiles').update({ [col]: null }).eq('id', me.id);
  if (!error) myProfile[col] = null;
  try { await sb.storage.from('avatars').remove(['png', 'jpg', 'jpeg', 'gif', 'webp'].map(ext => `${me.id}/${kind}.${ext}`)); } catch (e) {}
}
$('avUp').onclick = () => uploadMedia('avatar'); $('bnUp').onclick = () => uploadMedia('banner');
$('avClear').onclick = () => clearMedia('avatar'); $('bnClear').onclick = () => clearMedia('banner');
$('proxyTest').onclick = testProxy;
$('bwClear').onclick = async () => { if (await ask({ title: 'Clear browsing data?', html: 'Signs you out of sites and clears history and cache in Auoris’s browser.', ok: 'Clear', danger: true })) { await api().browser_clear_data(); toast('Browser', 'Browsing data cleared.'); } };
$('setExplore').onclick = () => { $('settings').close(); showView('explore'); };
$('openData').onclick = () => api().open_data_folder();
$('openPlugins').onclick = () => api().open_plugins_folder();
$('clearUsage').onclick = async () => { if (await ask({ title: t('s.clearUsage') + '?', html: esc(t('s.clearUsageHint')), ok: t('s.clear'), danger: true })) { await api().clear_usage(); toast(t('usage'), '✓'); } };
$('clearChats').onclick = async () => {
  if (!await ask({ title: t('s.clearChats') + '?', html: esc(t('s.clearChatsHint')), ok: t('s.deleteAll'), danger: true })) return;
  const r = await api().clear_history();
  if (!r) { toast('Busy', 'Wait for the current reply to finish first.'); return; }
  chatId = r.chat_id; showEmpty(); refreshChats(); toast(t('s.clearChats'), `${r.deleted} deleted`);
};
$('settingsBtn').onclick = () => openSettings('general');


// ================================================================ clickable files / folders in the chat
const PATHISH = /^(?:[a-zA-Z]:[\\/]|\.{0,2}[\\/]|~[\\/])?[\w .()+@#&'-]*(?:[\\/][\w .()+@#&'-]+)*\.?[\w-]*$/;
let linkTimer = null;
function looksLikePath(t) {
  t = t.trim();
  if (t.length < 2 || t.length > 260 || /\s{2,}|[<>|*?"]/.test(t)) return false;
  if (!/[\\/]/.test(t) && !/\.[A-Za-z0-9]{1,8}$/.test(t)) return false;  // needs a folder separator or a file extension
  if (/^\d+(\.\d+)+$/.test(t) || /^https?:/i.test(t)) return false;       // version numbers, URLs
  return PATHISH.test(t);
}
const linkRoots = new Set();
function linkFiles(root = log) {
  linkRoots.add(root);
  clearTimeout(linkTimer);
  linkTimer = setTimeout(async () => {
    const roots = [...linkRoots]; linkRoots.clear();
    const els = roots.flatMap(r => [...r.querySelectorAll('.bubble :not(pre) > code:not([data-fr])')]).filter(el => { el.dataset.fr = '1'; return looksLikePath(realText(el)); });
    if (!els.length) return;
    const texts = [...new Set(els.map(el => realText(el).trim()))];
    let map = {};
    try { map = await api().resolve_paths(texts) || {}; } catch (e) { return; }
    for (const el of els) {
      const hit = map[realText(el).trim()];
      if (!hit) continue;
      el.classList.add('fileref'); el.dataset.path = hit.path; if (hit.dir) el.dataset.dir = '1';
      el.title = (hit.dir ? 'Folder: ' : '') + hit.path + ' — click to open, right-click for more';
    }
  }, 150);
}
const RUNNABLE = /\.(exe|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|com|lnk|hta|reg|cpl|jar|py|pyw|url|scf)$/i;
let editorName = 'Notepad';
async function fileAction(action, path) {
  const r = await api().file_action(action, path);
  if (r && r.error) toast('Couldn\'t do that', r.error);
}
function openFileRef(el) {
  const p = el.dataset.path;
  if (el.dataset.dir) return fileAction('open', p);
  if (/\.html?$/i.test(p)) return openLink('file:///' + p.replace(/\\/g, '/'));
  fileAction('open', p);
}
function fileMenu(ev, el) {
  ev.preventDefault(); ev.stopPropagation();
  closeMenus();
  const p = el.dataset.path, dir = !!el.dataset.dir, name = p.split('\\').pop();
  const html = /\.html?$/i.test(p), runnable = RUNNABLE.test(p);
  const items = dir
    ? [['open', '📂', 'Open folder'], ['reveal', '🗂', 'Show in File Explorer'], ['terminal', '›_', 'Open terminal here'], ['cwd', '📌', 'Use as working folder'], ['sep'], ['copy', '⧉', 'Copy path'], ['copyname', '🏷', 'Copy name']]
    : [...(html ? [['tbrowser', '🌐', 'Open in Auoris browser'], ['browser', '↗', 'Open in default browser']] : [['open', '📄', runnable ? `Open as text (${editorName})` : 'Open']]),
       ['edit', '✎', `Edit in ${editorName}`], ['reveal', '🗂', 'Show in File Explorer'], ['terminal', '›_', 'Open terminal here'], ['sep'],
       ['copy', '⧉', 'Copy path'], ['copyname', '🏷', 'Copy name']];
  const m = document.createElement('div'); m.className = 'pmenu ctx';
  m.innerHTML = `<div class="mh ctxh" title="${esc(p)}"><span>${dir ? '📁' : '📄'}</span><div><b>${esc(name)}</b><small>${esc(p)}</small></div></div>` +
    items.map(([a, i, label]) => a === 'sep' ? '<div class="sep2"></div>' : `<button class="mi" data-a="${a}"><span class="i">${i}</span>${esc(label)}</button>`).join('');
  document.body.appendChild(m);
  const z = prefs.font_scale || 1, x = ev.clientX / z, y = ev.clientY / z;
  m.style.left = Math.min(x, innerWidth / z - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight / z - m.offsetHeight - 8) + 'px';
  m.querySelectorAll('.mi').forEach(b => b.onclick = e => {
    e.stopPropagation(); closeMenus();
    const a = b.dataset.a;
    if (a === 'copy') { copyText(p); toast('Copied', p); }
    else if (a === 'copyname') { copyText(name); toast('Copied', name); }
    else if (a === 'tbrowser') openInAuorisBrowser('file:///' + p.replace(/\\/g, '/'));
    else if (a === 'cwd') { fileAction('cwd', p); }
    else fileAction(a, p);
  });
}
log.addEventListener('click', e => {
  const el = e.target.closest('code.fileref');
  if (el) { e.preventDefault(); openFileRef(el); }
});
log.addEventListener('contextmenu', e => {
  const el = e.target.closest('.fileref');
  if (el) fileMenu(e, el);
});
window.addEventListener('pywebviewready', async () => { try { editorName = await api().editor_name(); } catch (e) {} });


// ================================================================ built-in browser
// The page reserves #bwArea; Python lays a real Edge (WebView2) view exactly over it.
let bwStarted = false, bwLast = {};
function bwRect() {
  const r = $('bwArea').getBoundingClientRect(), d = devicePixelRatio;
  return [r.left * d, r.top * d, r.width * d, r.height * d];
}
let bwRectKey = '';
function pushBounds() {
  if (view !== 'browser') return;
  const r = bwRect(), key = r.map(Math.round).join(',');
  if (key === bwRectKey) return;
  bwRectKey = key; api().browser_bounds(...r);
}
new ResizeObserver(() => pushBounds()).observe($('bwArea'));
window.addEventListener('resize', pushBounds);
// Native views draw above HTML, so hide it whenever a dialog or menu would sit on top of it
let bwShown = false;
function syncBrowser() {
  const want = view === 'browser' && bwStarted && !document.querySelector('dialog[open], .pmenu:not([hidden])');
  if (want) pushBounds();
  if (want !== bwShown) { bwShown = want; api().browser_show(want); }
}
new MutationObserver(() => syncBrowser()).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden'] });
function browserOpened() {
  bwRectKey = '';
  if (!bwStarted) { bwStarted = true; api().browser_state().then(bwState); }
  setTimeout(() => { pushBounds(); syncBrowser(); if (!bwLast.url) $('bwUrl').focus(); }, 60);
}
function bwState(st) {
  bwLast = { ...bwLast, ...st };
  if (st.ready) $('bwWait').hidden = true;
  if (st.url !== undefined && document.activeElement !== $('bwUrl')) $('bwUrl').value = st.url === 'about:blank' ? '' : st.url;
  $('bwBack').disabled = !bwLast.back; $('bwFwd').disabled = !bwLast.fwd;
  const secure = /^https:/i.test(bwLast.url || ''), local = /^file:/i.test(bwLast.url || '');
  $('bwLock').textContent = local ? '📄' : secure ? '🔒' : bwLast.url ? '⚠' : '🔍';
  $('bwLock').title = local ? 'Local file' : secure ? 'Secure connection' : bwLast.url ? 'Not secure' : '';
  if (st.loading !== undefined) { $('bwReload').textContent = st.loading ? '✕' : '↻'; $('bwReload').title = st.loading ? 'Stop' : 'Reload (F5)'; $('bwProg').classList.toggle('on', st.loading); }
  $('bwProxy').hidden = !bwLast.proxy; $('bwProxy').title = 'Going through proxy ' + (bwLast.proxy || '');
  $('proxyBadge').textContent = bwLast.proxy ? '🛡' : '';
  if (st.error) toast('Page didn\'t load', st.error.replace(/([a-z])([A-Z])/g, '$1 $2'));
}
let bwPending = '';   // the address the built-in browser was last asked to open
function bwError(msg) {
  $('bwWait').innerHTML = esc(msg);
  const short = String(msg || '').split(/\s+at\s+|\r?\n/)[0].slice(0, 160);
  if (/^https?:\/\//i.test(bwPending)) {   // the built-in browser can't start on this PC (WebView2): use the normal browser so the page still opens
    api().open_url(bwPending);
    toast('Browser', short + ' - opened it in your normal browser instead.');
  } else toast('Browser', short);
}
function openInAuorisBrowser(url) {
  showView('browser');
  $('bwUrl').value = url; $('bwUrl').blur();
  bwPending = url;
  api().browser_open(url);
}
$('bwUrl').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); api().browser_open($('bwUrl').value).then(u => { $('bwUrl').value = u; }); $('bwUrl').blur(); }
  if (e.key === 'Escape') { $('bwUrl').value = bwLast.url || ''; $('bwUrl').blur(); }
});
$('bwUrl').addEventListener('focus', () => setTimeout(() => $('bwUrl').select()));
$('bwBack').onclick = () => api().browser_cmd('back');
$('bwFwd').onclick = () => api().browser_cmd('fwd');
$('bwReload').onclick = () => api().browser_cmd(bwLast.loading ? 'stop' : 'reload');
$('bwHome').onclick = () => api().browser_cmd('home');
$('bwDev').onclick = () => api().browser_cmd('devtools');
$('bwExt').onclick = () => { if (bwLast.url && bwLast.url !== 'about:blank') api().open_url(bwLast.url); };
document.addEventListener('keydown', e => {
  if (view !== 'browser') return;
  if (e.key === 'F5') { e.preventDefault(); api().browser_cmd('reload'); }
  if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); $('bwUrl').focus(); }
  if (e.altKey && e.key === 'ArrowLeft') api().browser_cmd('back');
  if (e.altKey && e.key === 'ArrowRight') api().browser_cmd('fwd');
});

// ---- the choice: Auoris's browser or the default one
async function openLink(url) {
  let where = prefs.link_open || 'ask';
  if (where === 'ask') {
    where = await chooseBrowser(url);
    if (!where) return;
  }
  if (where === 'default') api().open_url(url);
  else openInAuorisBrowser(url);
}
function chooseBrowser(url) {
  if ($('confirmDlg').open) return Promise.resolve('default');
  return new Promise(resolve => {
    const d = $('confirmDlg');
    $('cTitle').textContent = 'Open this link where?';
    $('cMsg').innerHTML = `<span class="linkurl">${esc(url)}</span><label class="chk" style="margin-top:12px"><input type="checkbox" id="cRemember"> Remember my choice <small>change it later in Settings → Browser</small></label>`;
    $('cIcon').textContent = '🌐'; d.classList.add('safe');
    const ok = $('cOk'), cancel = $('cCancel');
    ok.textContent = 'Auoris browser'; ok.className = 'primary';
    cancel.textContent = 'Default browser';
    const done = v => {
      d.close(); ok.onclick = cancel.onclick = d.oncancel = null; cancel.textContent = 'Cancel';
      if (v && $('cRemember')?.checked) { prefs.link_open = v; api().set_setting('link_open', v); }
      resolve(v);
    };
    ok.onclick = () => done('auoris');
    cancel.onclick = () => done('default');
    d.oncancel = e => { e.preventDefault(); done(null); };
    d.onclick = e => { if (outside(d, e)) done(null); };
    d.showModal(); ok.focus();
  });
}
[log, $('dlgList'), $('xCmpOut')].forEach(box => box.addEventListener('click', e => {   // every place md() output is shown
  const a = e.target.closest('a.xlink');
  if (a) { e.preventDefault(); openLink(a.getAttribute('href')); }
}));

// ---- browser settings
async function testProxy() {
  const url = $('proxyUrl').value.trim();
  $('proxyTest').disabled = true; $('proxyRes').className = 'vsub'; $('proxyRes').textContent = 'Testing…';
  const r = await api().test_proxy(url);
  $('proxyTest').disabled = false;
  if (r.ok) {
    $('proxyRes').className = 'vsub good';
    $('proxyRes').textContent = r.ip === r.direct_ip ? `⚠ Works, but your IP didn't change (${r.ip}) — the proxy may not hide you.`
      : `✓ Works (${r.ms} ms). Sites will see ${r.ip} instead of your IP ${r.direct_ip}.`;
  } else { $('proxyRes').className = 'vsub bad'; $('proxyRes').textContent = '✕ ' + r.error; }
}


// ================================================================ model picker (local + cloud)
const PROV_ICON = { anthropic: '✳', openai: '◎', gemini: '✦', openrouter: '⇄', groq: '⚡', mistral: '▲', deepseek: '◆', xai: '✕', claude_code: '✳', codex: '◎', gemini_cli: '✦', custom: '⚙' };
function modelLabel(v) {
  if (!v) return 'Model';
  const m = v.match(/^cloud\/([^/]+)\/(.+)$/);
  return m ? m[2] : v.replace(/^hf\.co\/[^/]+\//, '').replace(/-GGUF(?=:|$)/i, '');
}
const EFFORT_NEAR = { minimal: ['low', 'medium'], low: ['minimal', 'medium'], medium: ['high', 'low'], high: ['max', 'medium'], max: ['high'], vibing: ['max', 'high'] };
const EFFORT_OWN = { openai: 'ChatGPT', gemini: 'Gemini', openrouter: 'OpenRouter', xai: 'Grok' };
let effortFor = '';
async function effortMenu() {
  const v = prefs.model || ''; if (v === effortFor) return; effortFor = v;
  let lv = null; try { lv = await api().effort_levels(v); } catch (e) {}
  if (!Array.isArray(lv) || !lv.length) return;
  const sel = $('effortSel'), cur = prefs.effort || 'medium', prov = v.startsWith('cloud/') ? v.split('/')[1] : '';
  sel.innerHTML = lv.map(x => `<option value="${esc(x)}" data-i18n="effort.${esc(x)}">${esc(t('effort.' + x))}</option>`).join('');
  // the saved level stays as it is (a model without it uses the nearest one); the menu just shows that nearest one
  sel.value = lv.includes(cur) ? cur : ((EFFORT_NEAR[cur] || []).find(x => lv.includes(x)) || 'medium');
  const own = lv.includes('minimal') || lv.length !== 5;
  sel.title = (own && EFFORT_OWN[prov] ? `Effort uses ${EFFORT_OWN[prov]}'s own reasoning levels for this model. ` : 'Effort: how thorough the model is and how many steps it may take. ') +
    'Vibing: always thinks, at the highest setting, with the most steps and a step-by-step working method.';
  sel.classList.toggle('vibing', sel.value === 'vibing');
}
function updateModelChip() {
  effortMenu();
  const v = prefs.model || '', cloud = v.startsWith('cloud/');
  $('mcName').textContent = modelLabel(v);
  $('mcIco').textContent = cloud ? '☁' : '◐';
  $('modelChip').classList.toggle('cloud', cloud);
  $('modelChip').title = (cloud ? 'Cloud model — messages go to ' + v.split('/')[1] : 'Local model — runs on your PC') + '\n' + v;
}
let modelData = null;
async function openModelMenu() {
  closeMenus();
  const m = document.createElement('div'); m.className = 'pmenu models';
  m.innerHTML = '<input placeholder="Search models…" spellcheck="false"><div class="mlist"><div class="mgrp">Loading models…</div></div>' +
    '<div class="mfoot"><button class="mi" data-cmp><span class="i">⇄</span>Compare models…</button><button class="mi" data-add><span class="i">＋</span>Add a cloud provider (Claude, ChatGPT…)</button></div>';
  document.body.appendChild(m);
  const b = $('modelChip').getBoundingClientRect(), z = prefs.font_scale || 1;
  m.style.left = Math.max(8, b.left / z) + 'px'; m.style.bottom = (innerHeight / z - b.top / z + 8) + 'px'; m.style.top = 'auto';
  m.querySelector('[data-add]').onclick = e => { e.stopPropagation(); closeMenus(); openSettings('providers'); };
  m.querySelector('[data-cmp]').onclick = e => { e.stopPropagation(); closeMenus(); xCompareOpen(); };
  const search = m.querySelector('input'); setTimeout(() => search.focus());
  m.onclick = e => e.stopPropagation();
  modelData = await api().models_all();
  const draw = () => {
    const q = search.value.toLowerCase(), cur = prefs.model;
    const item = (value, label, extra) => `<button class="mi ${value === cur ? 'cur' : ''}" data-v="${esc(value)}" title="${esc(value)}">${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`;
    let html = '';
    const local = modelData.local.filter(n => !q || n.toLowerCase().includes(q));
    if (local.length) html += `<div class="mgrp"><span>◐ On this PC</span><span>free · private</span></div>` + local.map(n => item(n, modelLabel(n))).join('');
    for (const g of modelData.cloud) {
      const ms = g.models.filter(x => !q || (x.id + ' ' + x.name).toLowerCase().includes(q));
      if (!ms.length && !g.error) continue;
      html += `<div class="mgrp"><span>${PROV_ICON[g.id] || '☁'} ${esc(g.name)}</span><span>cloud</span></div>`;
      if (g.error) html += `<div class="merr">${esc(g.error)}</div>`;
      html += ms.slice(0, q ? 200 : 60).map(x => item(x.value, x.name !== x.id ? x.name : x.id, x.name !== x.id ? x.id : '')).join('');
    }
    m.querySelector('.mlist').innerHTML = html || '<div class="mgrp">No models match.</div>';
    m.querySelectorAll('[data-v]').forEach(el => el.onclick = async () => { closeMenus(); await useModel(el.dataset.v); });
  };
  search.oninput = draw; draw();
  search.onkeydown = e => { if (e.key === 'Enter') m.querySelector('[data-v]')?.click(); if (e.key === 'Escape') closeMenus(); };
}
$('modelChip').onclick = e => { e.stopPropagation(); document.querySelector('.pmenu.models') ? closeMenus() : openModelMenu(); };

// ================================================================ AI providers settings
let lastBrowserProvider = null;
async function drawProviders() {
  if (lastBrowserProvider) { const p = lastBrowserProvider; lastBrowserProvider = null; setTimeout(() => document.querySelector(`.prov[data-p="${p}"] .pkey`)?.focus(), 60); }
  const list = await api().providers_info();
  $('provList').innerHTML = list.map(pv => pv.kind === 'cli' ? `
    <div class="prov" data-p="${pv.id}" data-cli="1">
      <div class="ph"><span>${PROV_ICON[pv.id] || '⌨'}</span><b>${esc(pv.name)}</b><span class="st">checking…</span></div>
      <div class="pk"><button class="btn sm cinst" hidden>Install</button><button class="btn sm clogin" hidden>Sign in</button><button class="btn sm ptest">Test</button></div>
      <div class="pmsg">No API key: chat uses your own ${({ codex: 'ChatGPT plan', gemini_cli: 'Google account' })[pv.id] || 'Claude plan'}'s usage through the ${({ codex: 'Codex', gemini_cli: 'Gemini CLI' })[pv.id] || 'Claude Code'} app (installed for you if missing). Chat only - its own file and shell tools stay off.</div>
    </div>` : `
    <div class="prov ${pv.has_key ? 'on' : ''}" data-p="${pv.id}">
      <div class="ph"><span>${PROV_ICON[pv.id] || '☁'}</span><b>${esc(pv.name)}</b>
        <span class="st">${pv.has_key ? '✓ key saved ' + esc(pv.masked) : pv.id === 'custom' && pv.base ? esc(pv.base) : 'not set up'}</span></div>
      <div class="pk">${pv.id === 'custom' ? `<input class="pbase" placeholder="Base URL, e.g. http://localhost:1234/v1" value="${esc(pv.base || '')}">` : ''}
        <input class="pkey" type="password" autocomplete="off" spellcheck="false" placeholder="${pv.has_key ? 'Paste a new key to replace it' : 'Paste your API key'}${pv.id === 'custom' ? ' (optional)' : ''}">
        <button class="btn sm psave">Save</button>${pv.has_key || pv.base ? '<button class="btn sm ptest">Test</button><button class="btn sm prm" title="Remove key">✕</button>' : ''}</div>
      <div class="pmsg">${pv.keys_url ? `<a class="xlink pget" href="${esc(pv.keys_url)}">Get a key ↗</a> · <a class="xlink psignin" href="${esc(pv.keys_url)}">Sign in inside Auoris</a>` : 'Any server that speaks the OpenAI API (LM Studio, vLLM, llama.cpp server…)'}</div>
    </div>`).join('');
  api().aicli_status().then(st => {
    $('provList').querySelectorAll('.prov[data-cli]').forEach(el => {
      const s = (st || {})[el.dataset.p] || {};
      el.classList.toggle('on', !!(s.installed && s.signed_in !== false));
      el.querySelector('.st').textContent = !s.installed ? 'not installed' : s.signed_in === false ? 'installed · not signed in' : s.signed_in ? '✓ signed in' : 'installed';
      el.querySelector('.cinst').hidden = !!s.installed;
      el.querySelector('.clogin').hidden = !s.installed || s.signed_in === true;
    });
  }).catch(() => {});
  $('provList').querySelectorAll('.prov[data-cli]').forEach(el => {
    const id = el.dataset.p, msg = el.querySelector('.pmsg');
    const note = (r) => { msg.className = 'pmsg ' + (r.ok ? 'good' : 'bad'); msg.textContent = (r.ok ? '✓ ' : '✕ ') + r.message; };
    el.querySelector('.cinst').onclick = async () => { msg.className = 'pmsg'; msg.textContent = 'Installing - this can take a few minutes…'; el.querySelector('.cinst').disabled = true; const r = await api().aicli_install(id); await drawProviders(); const m2 = $('provList').querySelector(`.prov[data-p="${id}"] .pmsg`); if (m2) { m2.className = 'pmsg ' + (r.ok ? 'good' : 'bad'); m2.textContent = (r.ok ? '✓ ' : '✕ ') + r.message; } };
    el.querySelector('.clogin').onclick = async () => note(await api().aicli_login(id));
  });
  $('provList').querySelectorAll('.prov').forEach(el => {
    const id = el.dataset.p, msg = el.querySelector('.pmsg');
    const show = (r) => { msg.className = 'pmsg ' + (r.ok ? 'good' : 'bad'); msg.textContent = r.ok ? `✓ Connected — ${r.count} models available` : '✕ ' + r.error; };
    if (el.dataset.cli) { el.querySelector('.ptest').onclick = async () => { msg.className = 'pmsg'; msg.textContent = 'Testing…'; const r = await api().provider_test(id); msg.className = 'pmsg ' + (r.ok ? 'good' : 'bad'); msg.textContent = r.ok ? '✓ Ready - pick its models from the model menu' : '✕ ' + r.error; drawProviders.again = 1; }; return; }
    el.querySelector('.psave').onclick = async () => {
      const key = el.querySelector('.pkey').value.trim(), base = el.querySelector('.pbase')?.value.trim();
      if (!key && base === undefined) { msg.className = 'pmsg bad'; msg.textContent = 'Paste a key first.'; return; }
      msg.className = 'pmsg'; msg.textContent = 'Checking the key…';
      const r = await api().provider_save(id, key || null, base ?? null);
      el.querySelector('.pkey').value = '';
      await drawProviders();
      show.call(null, r); const again = $('provList').querySelector(`.prov[data-p="${id}"] .pmsg`); if (again) { again.className = 'pmsg ' + (r.ok ? 'good' : 'bad'); again.textContent = r.ok ? `✓ Connected — ${r.count} models available` : '✕ ' + r.error; }
    };
    el.querySelector('.ptest')?.addEventListener('click', async () => { msg.className = 'pmsg'; msg.textContent = 'Testing…'; show(await api().provider_test(id)); });
    el.querySelector('.prm')?.addEventListener('click', async () => {
      if (!await ask({ title: 'Remove this key?', html: 'Cloud models from this provider will stop working until you add a key again.', ok: 'Remove', danger: true })) return;
      await api().provider_remove(id); drawProviders();
    });
    el.querySelector('.pget')?.addEventListener('click', e => { e.preventDefault(); api().open_url(e.target.getAttribute('href')); });
    el.querySelector('.psignin')?.addEventListener('click', e => {
      e.preventDefault();
      lastBrowserProvider = id;
      $('settings').close();
      showView('browser');
      bwPending = e.target.getAttribute('href');
      api().browser_open(bwPending);
      toast('Sign in, then create a key', 'Copy it, come back to Settings → AI providers, and paste it in.');
    });
  });
}
document.querySelector('.settabs [data-tab="providers"]').addEventListener('click', drawProviders);
document.querySelector('.settabs [data-tab="plugins"]').addEventListener('click', () => renderPluginList());   // defined in a later <script>, so it can't be passed by name at load

// ---- "this API hit a limit" -> offer to switch models
const LIMIT_ICON = { quota: '💳', vision: '🖼', model: '🚫', auth: '🔑', rate_limit: '⏳' };
const LIMIT_LABEL = { quota: 'ran out of credits', vision: "can't read the image you attached", model: "doesn't have that model",
  auth: 'rejected the API key', rate_limit: 'is rate-limited right now' };
async function providerLimited(cid, providerId, providerName, model, category, message) {
  const icon = LIMIT_ICON[category] || '⚠', label = LIMIT_LABEL[category] || 'hit a problem';
  $('swTitle').textContent = `${icon} ${providerName} ${label}`;
  $('swMsg').textContent = message;
  $('swList').innerHTML = '<div class="vsub">Looking for another model…</div>';
  $('switchDlg').showModal();
  let done = false;
  const choose = v => {
    if (done) return; done = true;
    $('switchDlg').close();
    api().provider_switch_choice(cid, v);
    if (v) { prefs.model = v; updateModelChip(); toast('Switched model', modelLabel(v) + ' will pick up from here.'); }
  };
  $('swCancel').onclick = () => choose(null);
  $('swClose').onclick = () => choose(null);
  $('switchDlg').onclick = e => { if (outside($('switchDlg'), e)) choose(null); };
  $('switchDlg').oncancel = e => { e.preventDefault(); choose(null); };
  const d = await api().models_all();
  if (done) return;
  const opts = [];
  for (const n of d.local) opts.push({ v: n, l: modelLabel(n), sub: 'On this PC · free' });
  for (const g of d.cloud) { if (g.id === providerId) continue; for (const x of g.models.slice(0, 20)) opts.push({ v: x.value, l: x.name, sub: g.name }); }
  $('swList').innerHTML = opts.length
    ? opts.map(o => `<button class="swopt" data-v="${esc(o.v)}">${esc(o.l)}<small>${esc(o.sub)}</small></button>`).join('')
    : '<div class="vsub">No other models are set up yet. Add one in Settings → AI providers, or install a local model in Explore.</div>';
  $('swList').querySelectorAll('.swopt').forEach(b => b.onclick = () => choose(b.dataset.v));
}

// routine editor: fill the model list
async function fillRoutineModels(selected) {
  const sel = $('rtModel');
  sel.innerHTML = '<option value="">Same as my chat model</option>';
  const d = await api().models_all();
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  let html = d.local.length ? `<optgroup label="On this PC">${d.local.map(n => opt(n, modelLabel(n))).join('')}</optgroup>` : '';
  for (const g of d.cloud) if (g.models.length) html += `<optgroup label="${esc(g.name)} (cloud)">${g.models.slice(0, 80).map(x => opt(x.value, x.id)).join('')}</optgroup>`;
  sel.insertAdjacentHTML('beforeend', html);
  if (selected && ![...sel.options].some(o => o.value === selected)) sel.insertAdjacentHTML('beforeend', opt(selected, modelLabel(selected)));
  sel.value = selected || '';
}

// ================================================================ views
let view = 'chat';
// Each entry: [name, loader fn name or null]. The loader (if present and defined) runs every time the view
// is switched into - same lazy-load-on-first-visit pattern as loadMessages() for the Messages view (which
// folds in what used to be the separate Friends/DMs, Servers and Group Chats views - see "MESSAGES VIEW" below).
const EXTRA_VIEWS = [['messages', 'loadMessages'], ['projects', 'loadProjects'], ['plus', 'loadPlus']];
const SOCIAL_VIEWS = new Set(EXTRA_VIEWS.map(x => x[0]));
// Auoris and Auoris Mind are this one page (app.py MIND): Auoris is Minecraft and social, Auoris Mind the AI. Each opens only its own
// views and hides the other's parts (the app-auoris / app-mind body class); Auoris's sidebar is one list without the Workspace tab.
let MIND_APP = true;   // until init says which app this is
const MIND_ONLY = new Set(['chat', 'explore', 'routines', 'browser', 'artifacts', 'projects']), AUORIS_ONLY = new Set(['minecraft', 'messages']);
function appMode(mode) {
  MIND_APP = mode === 'mind';
  document.body.classList.add(MIND_APP ? 'app-mind' : 'app-auoris');
  if (MIND_APP) { document.querySelector('#side .brand b').textContent = 'Auoris Mind'; return; }
  document.querySelector('.navgroup[data-g="social"]').prepend($('navMinecraft'));   // Minecraft, Messages, Auoris Plus, Auoris Mind
  setNavGroup('social');
  $('mcBackBtn').title = 'Messages and friends';
}
function setNavGroup(g) {
  if (!MIND_APP) g = 'social';
  document.querySelectorAll('.navtab').forEach(b => b.classList.toggle('on', b.dataset.g === g));
  document.querySelectorAll('.navgroup').forEach(el => el.hidden = el.dataset.g !== g);
}
document.querySelectorAll('.navtab').forEach(b => b.onclick = () => setNavGroup(b.dataset.g));
function showView(v) {
  if (MIND_APP ? AUORIS_ONLY.has(v) : MIND_ONLY.has(v)) v = MIND_APP ? 'chat' : 'messages';   // the other app's view: this app's home
  view = v;
  const names = ['chat', 'explore', 'routines', 'browser', 'artifacts', 'minecraft', ...EXTRA_VIEWS.map(x => x[0])];
  for (const n of names) $(n + 'View').hidden = n !== v;
  if (SOCIAL_VIEWS.has(v)) setNavGroup('social'); else if (v !== 'chat') setNavGroup('workspace');
  $('navExplore').classList.toggle('on', v === 'explore');
  $('navRoutines').classList.toggle('on', v === 'routines');
  $('navBrowser').classList.toggle('on', v === 'browser');
  $('navArtifacts').classList.toggle('on', v === 'artifacts');
  $('navMinecraft').classList.toggle('on', v === 'minecraft');
  for (const [n] of EXTRA_VIEWS) $('nav' + n[0].toUpperCase() + n.slice(1)).classList.toggle('on', v === n);
  for (const [n, fn] of EXTRA_VIEWS) if (v === n && typeof window[fn] === 'function') window[fn]();
  document.querySelectorAll('#chats .ci').forEach(c => c.classList.toggle('dim', v !== 'chat'));
  if (v === 'explore') loadExplore();
  if (v === 'routines') loadRoutines();
  if (v === 'browser') browserOpened();
  if (v === 'artifacts') loadArtifacts();
  if (v === 'minecraft' && typeof loadMinecraft === 'function') loadMinecraft();
  if (v === 'chat') setTimeout(() => input.focus());
  document.body.classList.toggle('view-browser', v === 'browser');
  syncBrowser();
}
// Right-click a tab > "Set as home screen": that tab opens when Auoris starts (instead of a new chat).
const HOME_VIEWS = ['explore', 'routines', 'browser', 'artifacts', 'minecraft', 'messages', 'projects', 'plus'];
async function homeStart(s) {
  const v = s && s.home_view;
  if (!v || !HOME_VIEWS.includes(v) || s.resume_chat) return;
  const social = ['messages', 'projects', 'plus'].includes(v);
  for (let i = 0; i < 40; i++) {   // up to ~20 s: let the sign-in screen / account setup finish first (Messages, Projects and Plus need the account)
    await new Promise(r => setTimeout(r, 500));
    if (typeof input !== 'undefined' && input.value.trim()) return;   // you already started typing: stay put
    if ($('auth') && !$('auth').hidden) continue;
    if (social && !(typeof me !== 'undefined' && me) && i < 24) continue;
    break;
  }
  if (view === 'chat' && !(typeof input !== 'undefined' && input.value.trim())) showView(v);
}
function homeMenuClose() { const m = $('homeMenu'); if (m) m.remove(); }
document.querySelectorAll('#side button[data-view]').forEach(btn => {
  btn.addEventListener('contextmenu', e => {
    const v = btn.dataset.view; if (!HOME_VIEWS.includes(v) || !MIND_APP) return;   // Auoris always opens on the launcher
    e.preventDefault(); homeMenuClose();
    const is = prefs.home_view === v, m = document.createElement('div'); m.id = 'homeMenu';
    m.style.cssText = 'position:fixed;z-index:9999;min-width:190px;padding:5px;border-radius:10px;background:var(--panel2,#1c2230);border:1px solid var(--border,#ffffff22);box-shadow:0 14px 40px rgba(0,0,0,.5)';
    m.innerHTML = `<div class="homeitem" style="padding:8px 12px;border-radius:7px;cursor:pointer;font-size:13.5px">${is ? 'Remove as home screen' : 'Set as home screen'}</div>`;
    document.body.appendChild(m);
    m.style.left = Math.min(e.clientX, innerWidth - 210) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - 50) + 'px';
    const it = m.querySelector('.homeitem');
    it.onmouseenter = () => it.style.background = 'rgba(255,255,255,.09)'; it.onmouseleave = () => it.style.background = '';
    it.onclick = () => {
      prefs.home_view = is ? '' : v; api().set_setting('home_view', prefs.home_view); homeMenuClose();
      toast('Home screen', is ? 'Auoris opens to a new chat again.' : (btn.textContent.replace(/\s+/g, ' ').trim() || v) + ' now opens when Auoris starts.');
    };
  });
});
document.addEventListener('click', homeMenuClose); document.addEventListener('keydown', e => { if (e.key === 'Escape') homeMenuClose(); }); window.addEventListener('blur', homeMenuClose);
$('navExplore').onclick = () => showView(view === 'explore' ? 'chat' : 'explore');
$('navRoutines').onclick = () => showView(view === 'routines' ? 'chat' : 'routines');
$('navArtifacts').onclick = () => showView(view === 'artifacts' ? 'chat' : 'artifacts');
$('navMinecraft').onclick = () => showView(view === 'minecraft' ? 'chat' : 'minecraft');
$('navBrowser').onclick = () => showView(view === 'browser' ? 'chat' : 'browser');
for (const [n] of EXTRA_VIEWS) $('nav' + n[0].toUpperCase() + n.slice(1)).onclick = () => showView(view === n ? 'chat' : n);
// Auoris's Auoris Mind buttons (sidebar and the launcher's rail): the first time it is added to the Start menu (app.py mind_open), then it opens
async function mindOpen() {
  if (!await api().mind_installed() && !await ask({ title: 'Get Auoris Mind?', icon: '✦', ok: 'Get Auoris Mind',
    html: 'Auoris Mind is the AI assistant, as its own app: chat, code, AI models and routines. It uses your Auoris account, so it can work with your group chats\' AI projects and with Minecraft.<br><br>It is added to your Start menu and opens now. Local AI models need Ollama, which Auoris Mind can install from Explore.' })) return;
  const r = await api().mind_open();
  if (r && r.error) toast('Auoris Mind', r.error);
}
$('navMind').onclick = $('mcMindBtn').onclick = mindOpen;
{ const _open = openChat, _new = newChat;
  openChat = async id => { if (view !== 'chat') { showView('chat'); if (id === chatId) return; } return _open(id); };
  newChat = async () => { showView('chat'); return _new(); };
  $('newBtn').onclick = newChat; }

// ================================================================ explore
const gbs = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB';
const ago = iso => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 864e5;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`; };
let exTimer = null, exSeq = 0;
async function loadExplore() { loadInstalled(); loadTools(); api().dl_jobs().then(downloadsChanged); if (!$('exResults').dataset.loaded) searchModels(); setTimeout(() => $('exSearch').focus()); }
async function loadInstalled() {
  const list = await api().installed_models();
  $('exInstalled').innerHTML = list.length ? '' : '<span class="vsub">No models installed yet.</span>';
  list.forEach((m, i) => {
    const c = document.createElement('div'); c.className = 'ichip' + (m.current ? ' cur' : ''); c.style.animationDelay = i * 30 + 'ms';
    c.innerHTML = `<span class="n" title="${esc(m.name)}">${esc(m.name.replace(/^hf\.co\//, ''))}</span><small>${gbs(m.size)}</small>` +
      (m.current ? '<span class="cur-tag">● in use</span>' : '<button class="use">Use</button><button class="del" title="Delete from disk">🗑</button>');
    const use = c.querySelector('.use'), del = c.querySelector('.del');
    if (use) use.onclick = () => useModel(m.name);
    if (del) del.onclick = async () => {
      if (!await ask({ title: 'Delete model?', html: `<b>${esc(m.name)}</b> (${gbs(m.size)}) will be removed from your disk. You can download it again later.`, ok: 'Delete', danger: true })) return;
      const r = await api().delete_model(m.name); if (r.error) toast('Couldn\'t delete', r.error); loadInstalled();
    };
    $('exInstalled').appendChild(c);
  });
}
async function useModel(name) {
  const ok = await api().set_model(name, prefs.num_ctx || 131072);
  if (!ok) { toast('Busy', 'Wait for the current reply to finish first.'); return; }
  prefs.model = name; updateModelChip();
  $('modelIn').value = name; toast('Switching model', name.replace(/^hf\.co\//, '') + ' is loading…'); loadInstalled();
}
async function searchModels() {
  const q = $('exSearch').value, seq = ++exSeq;
  const SORTS = { downloads: 'Most downloaded', trendingScore: 'Trending', likes: 'Most liked', lastModified: 'Recently updated', createdAt: 'Newest',
                  params_desc: 'Most params (of the popular ones loaded)', params_asc: 'Fewest params (of the popular ones loaded)' };
  $('exLabel').textContent = (q.trim() ? `Results for "${q.trim()}" · ` : '') + SORTS[$('exSort').value];
  $('exResults').innerHTML = Array(6).fill('<div class="skel"></div>').join('');
  const r = await api().hf_search(q, apiSort());
  if (seq !== exSeq) return;
  $('exResults').dataset.loaded = 1;
  if (r.error) { $('exResults').innerHTML = `<div class="exempty">${esc(r.error)}</div>`; return; }
  exModels = r.models; exVram = r.vram || exVram; exNext = r.next; exPage = 1; exAutoFill = 0;
  $('gpuNote').textContent = exVram ? `Your GPU: ${gbs(exVram)} VRAM.` : '';
  drawModelCards();
}
async function loadMoreModels() {
  if (!exNext || exLoading) return;
  exLoading = true; const seq = exSeq;
  $('exMoreBtn').disabled = true; $('exMoreBtn').textContent = 'Loading…';
  const r = await api().hf_search($('exSearch').value, apiSort(), exNext);
  exLoading = false;
  if (seq !== exSeq) return;  // search changed while loading
  if (r.error) { toast('Couldn\'t load more', r.error); updateMore(); return; }
  const have = new Set(exModels.map(m => m.id));
  const fresh = r.models.filter(m => !have.has(m.id));
  exModels = exModels.concat(fresh); exNext = r.next; exPage++;
  if (paramSort()) { const top = $('exploreView').scrollTop; drawModelCards(); $('exploreView').scrollTop = top; }  // re-sort everything
  else drawModelCards(fresh);
}
const paramSort = () => $('exSort').value.startsWith('params') ? $('exSort').value : null;
const apiSort = () => paramSort() ? 'downloads' : $('exSort').value;
function updateMore() {
  const shown = $('exResults').querySelectorAll('.mcard').length;
  $('exCount').textContent = exModels.length ? `Showing ${shown}${shown !== exModels.length ? ` of ${exModels.length} loaded` : ''} · page ${exPage}${exNext ? '' : ' · that\'s everything'}` : '';
  $('exMoreBtn').hidden = !exNext; $('exMoreBtn').disabled = false; $('exMoreBtn').textContent = 'Load more models';
}
$('exMoreBtn').onclick = loadMoreModels;
$('exploreView').addEventListener('scroll', () => {  // infinite scroll
  const v = $('exploreView');
  if (v.scrollTop + v.clientHeight > v.scrollHeight - 500) loadMoreModels();
});
let exModels = [], exVram = 0, exFilter = { max: 0, min: 0, fit: false }, exNext = null, exPage = 1, exLoading = false;
function fmtParams(p) { return p >= 1e9 ? (p / 1e9 >= 10 ? Math.round(p / 1e9) : +(p / 1e9).toFixed(1)) + 'B' : Math.round(p / 1e6) + 'M'; }
const q4Size = p => p * 0.6;  // Q4_K_M ≈ 4.8 bits per weight
function drawModelCards(appendOnly) {
  let src = appendOnly || exModels;
  const ps = paramSort();
  if (ps && !appendOnly) src = [...src].sort((a, b) => (a.params == null) - (b.params == null) || (ps === 'params_desc' ? b.params - a.params : a.params - b.params));
  const list = src.filter(m => {
    const b = (m.params || 0) / 1e9;
    if (exFilter.max && (!m.params || b > exFilter.max)) return false;
    if (exFilter.min && (!m.params || b < exFilter.min)) return false;
    if (exFilter.fit && (!m.params || fitOf(q4Size(m.params), exVram)[0] !== 'g')) return false;
    if (exFilter.unc && !UNCENSORED_RE.test(m.id)) return false;
    return true;
  });
  if (!appendOnly) {
    if (!exModels.length) { $('exResults').innerHTML = '<div class="exempty">No GGUF models found. Try another search.</div>'; updateMore(); return; }
    $('exResults').innerHTML = list.length ? '' : '<div class="exempty">Nothing on this page matches that filter — load more below.</div>';
  } else if (list.length) $('exResults').querySelector('.exempty')?.remove();
  list.forEach((m, i) => {
    const [own, ...rest] = m.id.split('/');
    const tags = [/vision|image-text/.test(m.tags.join(' ') + m.pipeline) ? '<span class="tagp v">vision</span>' : '',
                  UNCENSORED_RE.test(m.id) ? '<span class="tagp u">uncensored</span>' : '',
                  /coder|code/i.test(m.id) ? '<span class="tagp">code</span>' : ''].join('');
    let size = '';
    if (m.params) {
      let [cls, txt] = fitOf(q4Size(m.params), exVram);
      if (m.active && cls !== 'g' && m.active <= 8e9) [cls, txt] = ['m', 'Part on CPU · MoE, still quick'];
      const moe = m.active ? `<small title="Mixture-of-experts: only ${fmtParams(m.active)} are used per token, so it's faster than its size suggests"> · ${fmtParams(m.active)} active</small>` : '';
      size = `<div class="psize"><span class="pbadge" title="${m.params_exact ? 'Parameters (from the model file)' : 'Parameters (estimated from the name)'}">${m.params_exact ? '' : '~'}${fmtParams(m.params)} params${moe}</span>` +
        `<span class="fit ${cls}" title="${txt} — estimate for the Q4_K_M version">~${gbs(q4Size(m.params))} · ${txt}</span></div>`;
    }
    const c = document.createElement('button'); c.className = 'mcard'; c.style.animationDelay = Math.min(i, 12) * 25 + 'ms';
    c.innerHTML = `<div class="own">${esc(own)}</div><div class="nm" title="${esc(m.id)}">${esc(rest.join('/') || own)}</div>${size}
      <div class="st"><span>⬇ ${fk(m.downloads)}</span><span>♥ ${fk(m.likes)}</span><span>${ago(m.updated)}</span>${m.ctx ? `<span title="Max context">${fk(m.ctx)} ctx</span>` : ''}${tags}</div>`;
    c.onclick = () => openModel(m.id);
    $('exResults').appendChild(c);
  });
  updateMore();
  // a filter can hide a whole page — keep fetching until something shows up (max a few pages)
  if (appendOnly !== undefined || paramSort()) setTimeout(fillIfEmpty);
}
let exAutoFill = 0;
const UNCENSORED_RE = /uncensor|abliterat|heretic|unfilter|unrestrict|unaligned|unlocked|nsfw|jailbr|dolphin|lexi\b|no[-_ ]?refus|decensor/i;
$('exSize').querySelectorAll('button').forEach(b => b.onclick = () => {
  if (b.dataset.fit) { exFilter.fit = !exFilter.fit; b.classList.toggle('on', exFilter.fit); }
  else if (b.dataset.unc) { exFilter.unc = !exFilter.unc; b.classList.toggle('on', exFilter.unc); }
  else {
    exFilter.max = +(b.dataset.max || 0); exFilter.min = +(b.dataset.min || 0);
    $('exSize').querySelectorAll('button:not([data-fit]):not([data-unc])').forEach(x => x.classList.toggle('on', x === b));
  }
  exAutoFill = 0;
  drawModelCards(); fillIfEmpty();
});
function fillIfEmpty() {  // a strict filter can leave few results - pull more pages until there are some to show
  if ($('exResults').querySelectorAll('.mcard').length < 6 && exNext && !exLoading && (exAutoFill = (exAutoFill || 0) + 1) <= 6) loadMoreModels();
}
$('exSearch').oninput = () => { clearTimeout(exTimer); exTimer = setTimeout(searchModels, 400); };
$('exSearch').onkeydown = e => { if (e.key === 'Enter') { clearTimeout(exTimer); searchModels(); } };
$('exSort').onchange = searchModels;
function fitOf(size, vram) {
  const need = size + 1.2 * 1073741824;  // weights + ~8k context + overhead
  if (need <= vram) return ['g', 'Fits your GPU'];
  if (size <= vram * 1.9) return ['m', 'Part on CPU (slower)'];
  return ['b', 'Mostly CPU (slow)'];
}
let exCur = null;  // model shown in the dialog: {repo, m, results: {label: res}}
async function openModel(repo) {
  $('exTitle').textContent = repo; $('exBody').innerHTML = '<div class="skel"></div>'; $('exDlg').showModal();
  const m = await api().hf_model(repo);
  if (m.error) { $('exBody').innerHTML = `<div class="exempty">${esc(m.error)}</div>`; return; }
  exCur = { repo, m, results: {} };
  const meta = [m.params ? `<span><b>${(m.params / 1e9).toFixed(1)}B</b> params</span>` : '', m.arch ? `<span>arch <b>${esc(m.arch)}</b></span>` : '',
    m.ctx ? `<span>max context <b>${fk(m.ctx)}</b></span>` : '', `<span>⬇ <b>${fk(m.downloads)}</b></span>`, `<span>♥ <b>${fk(m.likes)}</b></span>`,
    m.license ? `<span>license <b>${esc(m.license)}</b></span>` : '', m.vision ? '<span class="tagp v">vision</span>' : ''].join('');
  const rows = m.quants.map((q, i) => {
    const [cls, txt] = fitOf(q.size, m.vram);
    return `<tr data-row="${i}"><td class="q">${esc(q.label)}${q.split ? ` <small class="ptxt">${q.files} parts</small>` : ''}</td><td>${gbs(q.size)}</td>
      <td><span class="fit ${cls}">${txt}</span></td><td class="meth"><span class="mchk">checking…</span></td><td class="act"></td></tr>`;
  }).join('');
  $('exBody').innerHTML = `<div class="exmeta">${meta}</div>
    ${m.quants.length ? `<div class="exdlbar"><span class="vsub" id="exCheckTxt">Checking every download method…</span><button class="btn" id="exAll" disabled>⬇ Download all</button></div>
      <div class="qscroll"><table class="qtable"><tr><th>Quant</th><th>Size</th><th>Fits ${gbs(m.vram)} GPU?</th><th>Download methods</th><th></th></tr>${rows}</table></div>`
      : '<div class="exempty">This repo has no GGUF model files.</div>'}
    <div class="exfoot"><span>Q4_K_M is a good default: fast and light. Q6/Q8 are a bit smarter but bigger.</span>
    <button class="linkb" id="exHF">View on Hugging Face ↗</button></div>`;
  $('exHF').onclick = () => api().open_url('https://huggingface.co/' + repo);
  m.quants.forEach((q, i) => drawAction(i));
  if (m.quants.length) { api().dl_check(repo, m.quants); $('exAll').onclick = downloadAll; }
}
const METHOD_LABEL = { ollama: 'Ollama pull', direct: 'Direct download', merge: 'Download + merge' };
function methodResult(repo, res) {
  if (!exCur || exCur.repo !== repo) return;
  exCur.results[res.label] = res;
  const i = exCur.m.quants.findIndex(q => q.label === res.label); if (i < 0) return;
  const q = exCur.m.quants[i], cell = document.querySelector(`#exBody tr[data-row="${i}"] .meth`); if (!cell) return;
  const badge = (ok, name, why) => `<span class="mb ${ok ? 'ok' : 'no'}" title="${esc(ok ? name + ' works' : why || 'Not available')}">${ok ? '✓' : '✕'} ${name}</span>`;
  const directName = q.split ? 'Download + merge' : 'Direct';
  cell.innerHTML = badge(res.ollama.ok, 'Ollama', res.ollama.why) + badge(res.direct.ok, directName, res.direct.why) +
    (res.direct.ok && res.direct.needs === 'llamacpp' && !dlTools.llamacpp ? '<span class="mb need" title="Auoris installs llama.cpp (18 MB) automatically when you download">+ installs llama.cpp</span>' : '');
  drawAction(i);
}
function methodsDone(repo) {
  if (!exCur || exCur.repo !== repo) return;
  const ok = exCur.m.quants.filter(q => exCur.results[q.label]?.best && !q.installed);
  const total = ok.reduce((s, q) => s + q.size, 0);
  const works = Object.values(exCur.results).filter(r => r.best).length;
  $('exCheckTxt').textContent = `${works} of ${exCur.m.quants.length} can be downloaded` + (works < exCur.m.quants.length ? ' — hover ✕ to see why the rest can\'t' : '');
  $('exAll').disabled = !ok.length;
  $('exAll').textContent = ok.length ? `⬇ Download all (${ok.length} · ${gbs(total)})` : '✓ Everything is downloaded';
}
function rateTxt(j) {
  if (!j.speed) return '';
  const e = j.eta, left = e == null ? '' : e < 60 ? ` · ${Math.ceil(e)}s left` : e < 3600 ? ` · ${Math.ceil(e / 60)} min left` : ` · ${(e / 3600).toFixed(1)} h left`;
  return ` · ${(j.speed / 1048576).toFixed(1)} MB/s${left}`;
}
function jobFor(tag) { return dlJobs.find(j => j.tag === tag && (j.state === 'queued' || j.state === 'running')); }
function drawAction(i) {
  const q = exCur.m.quants[i], res = exCur.results[q.label];
  const cell = document.querySelector(`#exBody tr[data-row="${i}"] .act`); if (!cell) return;
  const cur = (q.installed_as || '').toLowerCase() === (exCur.m.current || '').toLowerCase();
  const job = jobFor(q.tag);
  if (q.installed) cell.innerHTML = cur ? '<span class="cur-tag" style="color:var(--acc)">● in use</span>' : `<button class="primary sm" data-use>Use</button>`;
  else if (job) cell.innerHTML = `<div class="jprog" data-job="${job.id}"><span class="ptxt">${esc(job.status)}</span><div class="pbar show"><i style="width:${job.total ? job.done / job.total * 100 : 0}%"></i></div></div>`;
  else if (!res) cell.innerHTML = '<span class="ptxt">…</span>';
  else if (!res.best) cell.innerHTML = `<span class="ptxt" title="${esc(res.direct.why || res.ollama.why)}">not downloadable</span>`;
  else cell.innerHTML = `<button class="btn sm" data-dl title="Uses: ${METHOD_LABEL[res.best]}">⬇ Download</button>`;
  const use = cell.querySelector('[data-use]'); if (use) use.onclick = () => { useModel(q.installed_as); $('exDlg').close(); };
  const dl = cell.querySelector('[data-dl]'); if (dl) dl.onclick = () => enqueueQuants([q]);
}
function enqueueQuants(qs) {
  const items = qs.map(q => ({ repo: exCur.repo, quant: q.quant, tag: q.tag, method: exCur.results[q.label].best, files: q.file_list, size: q.size, split: q.split }));
  api().dl_enqueue(items);
}
async function downloadAll() {
  const qs = exCur.m.quants.filter(q => exCur.results[q.label]?.best && !q.installed && !jobFor(q.tag));
  const total = qs.reduce((s, q) => s + q.size, 0);
  if (!await ask({ title: `Download all ${qs.length} versions?`, html: `That's <b>${gbs(total)}</b> in total. They download one after another — you can keep using Auoris and cancel any of them.`, ok: 'Download all', icon: '⬇' })) return;
  enqueueQuants(qs);
}

// ---- download queue + tools
let dlJobs = [], dlTools = {};
function downloadsChanged(jobs) {
  const prev = new Map(dlJobs.map(j => [j.id, j.state]));
  dlJobs = jobs;
  for (const j of jobs) {
    if (prev.get(j.id) === 'running' && j.state === 'failed') toast('Download failed', `${j.quant}: ${j.error}`);
    if (prev.get(j.id) === 'running' && j.state === 'done') toast('✓ Downloaded', `${j.repo.split('/').pop()} ${j.quant} is ready — click Use to switch.`);
  }
  drawJobs();
  if (exCur) exCur.m.quants.forEach((q, i) => {
    const el = document.querySelector(`#exBody tr[data-row="${i}"] .jprog`), job = jobFor(q.tag);
    if (el && job && el.dataset.job === job.id) {
      el.querySelector('.ptxt').textContent = (job.total ? `${Math.round(job.done / job.total * 100)}%` : job.status) + rateTxt(job);
      el.querySelector('.pbar i').style.width = (job.total ? job.done / job.total * 100 : 0) + '%';
    } else if (!!el !== !!job) drawAction(i);
  });
}
function modelInstalled(tag, name) {
  if (exCur) {
    const q = exCur.m.quants.find(q => q.tag === tag);
    if (q) { q.installed = true; q.installed_as = name; drawAction(exCur.m.quants.indexOf(q)); methodsDone(exCur.repo); }
  }
  if (view === 'explore') loadInstalled();
}
function drawJobs() {
  const box = $('exJobs'), vis = dlJobs.length > 0;
  box.hidden = !vis; if (!vis) return;
  const active = dlJobs.filter(j => j.state === 'queued' || j.state === 'running').length;
  box.innerHTML = `<div class="ulabel">Downloads${active ? ` · ${active} in progress` : ''}<button class="linkb" id="jClear">clear finished</button></div>` + dlJobs.map(j => {
    const pct = j.total ? Math.round(j.done / j.total * 100) : 0;
    const st = { queued: 'Waiting…', running: `${j.status}${j.total ? ` · ${gbs(j.done)} / ${gbs(j.total)}` : ''}${rateTxt(j)}`, done: '✓ Installed',
                 failed: '✕ ' + (j.error || 'Failed'), cancelled: 'Cancelled' }[j.state];
    return `<div class="job ${j.state}"><div class="jn"><b>${esc(j.repo.split('/').pop())}</b> <span class="q">${esc(j.quant)}</span> <small>${esc(METHOD_LABEL[j.method] || '')}</small></div>
      <div class="js"><span title="${esc(st)}">${esc(st)}</span>${j.state === 'running' || j.state === 'queued' ? `<button class="linkb" data-cancel="${j.id}">cancel</button>` : ''}</div>
      ${j.state === 'running' ? `<div class="pbar show"><i style="width:${pct}%"></i></div>` : ''}</div>`;
  }).join('');
  box.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => api().dl_cancel(b.dataset.cancel));
  $('jClear').onclick = () => api().dl_clear();
}
async function loadTools() {
  dlTools = await api().dl_tools();
  const busyT = dlTools.busy || {};
  const chip = (id, ok, name, desc, installable) => `<div class="dtool ${ok ? 'ok' : 'miss'}" data-t="${id}"><span class="ti">${ok ? '✓' : '!'}</span><div><b>${name}</b><small>${desc}</small></div>` +
    (!ok && installable ? `<button class="btn sm" data-tool="${id}" ${busyT[id] ? 'disabled' : ''}>${busyT[id] ? 'Installing…' : 'Install'}</button>` : '') + `<div class="pbar"><i></i></div></div>`;
  $('exTools').innerHTML = `<div class="ulabel">Download methods</div><div class="tools">` +
    chip('ollama', dlTools.ollama && dlTools.ollama_running, 'Ollama', dlTools.ollama ? (dlTools.ollama_running ? 'Runs models · pulls single-file GGUFs' : 'Installed, not running') : 'Needed to run any model', !dlTools.ollama) +
    chip('llamacpp', dlTools.llamacpp, 'llama.cpp tools', dlTools.llamacpp ? 'Joins split GGUF files' : 'For split models — installs itself when needed', true) +
    chip('hf', dlTools.huggingface, 'Hugging Face', dlTools.huggingface ? 'Direct GGUF downloads' : 'Can\'t reach huggingface.co', false) + '</div>';
  $('exTools').querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { b.disabled = true; b.textContent = 'Installing…'; api().dl_install_tool(b.dataset.tool); });
}
function toolProgress(name, done, total, status) {
  const el = document.querySelector(`#exTools .dtool[data-t="${name}"]`); if (!el) return;
  el.querySelector('.pbar').classList.add('show'); el.querySelector('.pbar i').style.width = (total ? done / total * 100 : 0) + '%';
  el.querySelector('small').textContent = status + (total > 1 ? ` · ${Math.round(done / total * 100)}%` : '');
}
function toolDone(name, ok, err) {
  toast(ok ? `✓ ${name === 'ollama' ? 'Ollama' : 'llama.cpp'} installed` : 'Install failed', ok ? 'That download method is ready.' : err);
  loadTools();
}
$('exClose').onclick = () => $('exDlg').close();
$('exDlg').onclick = e => { if (outside($('exDlg'), e)) $('exDlg').close(); };

// ================================================================ routines
const RT_TEMPLATES = [
  { name: 'Morning project check', prompt: 'Go through each project folder here. For any that is a git repo, run git status and summarize what is uncommitted or not pushed. Keep it short.', type: 'weekdays', time: '09:00', perm: 'read' },
  { name: 'Downloads tidy-up report', prompt: 'List what is in my Downloads folder (C:\\Users\\' + '%USERNAME%' + '\\Downloads). Group files by type, point out large or old files I could delete. Do not delete anything.', type: 'daily', time: '18:00', perm: 'read' },
  { name: 'Build check', prompt: 'Build the project in this folder and run its tests if it has any. Report whether everything passes and summarize any errors.', type: 'daily', time: '12:00', perm: 'ai' },
  { name: 'Daily summary on open', prompt: 'Give me a quick overview of what is in this folder and anything that changed recently.', type: 'startup', perm: 'read' },
];
function schedText(r) {
  const s = r.schedule || {};
  return { daily: `Every day at ${s.time}`, weekdays: `Weekdays at ${s.time}`, hourly: `Every ${s.hours} hour${s.hours == 1 ? '' : 's'}`,
           startup: 'When Auoris opens', manual: 'Manual only' }[s.type] || 'Manual only';
}
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  return days === 0 ? `today ${t}` : days === 1 ? `tomorrow ${t}` : days === -1 ? `yesterday ${t}` : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
}
let routines = [];
// ================================================================ artifacts
const ART_TYPES = {
  code: ['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sh', '.ps1', '.sql', '.lua'],
  web: ['.html', '.htm', '.css', '.scss', '.json', '.xml', '.yml', '.yaml', '.toml'],
  doc: ['.md', '.txt', '.rtf', '.pdf', '.docx', '.doc'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'],
  data: ['.csv', '.tsv', '.db', '.sqlite', '.xlsx', '.xls'],
};
const ART_ICON = { code: '⌘', web: '🌐', doc: '📄', image: '🖼', data: '📊', other: '📦' };
function artCategory(ext) { for (const [k, list] of Object.entries(ART_TYPES)) if (list.includes(ext)) return k; return 'other'; }
let artItems = [], artType = '';
async function loadArtifacts() {
  $('artList').innerHTML = Array(6).fill('<div class="skel"></div>').join('');
  artItems = await api().list_artifacts();
  drawArtifacts();
}
function drawArtifacts() {
  const q = $('artSearch').value.trim().toLowerCase();
  const list = artItems.filter(a => (!artType || artCategory(a.ext) === artType) && (!q || a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q)));
  const box = $('artList'); box.innerHTML = '';
  if (!artItems.length) { box.innerHTML = '<div class="exempty art"><span class="eart files"></span>Nothing yet — files the AI creates or edits in Code mode will show up here.</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="exempty">No files match that search.</div>'; return; }
  let last = null, i = 0;
  for (const a of list) {
    const g = groupOf(a.when);
    if (g !== last) { const h = document.createElement('div'); h.className = 'grp'; h.style.margin = '16px 4px 8px'; h.textContent = g; box.appendChild(h); last = g; }
    const cat = artCategory(a.ext);
    const el = document.createElement('div'); el.className = 'artcard fileref'; el.dataset.path = a.path; el.style.animationDelay = Math.min(i++, 14) * 25 + 'ms';
    el.innerHTML = `<span class="arti">${ART_ICON[cat]}</span>
      <div class="artmain"><div class="artname" title="${esc(a.path)}">${esc(a.name)}</div><div class="artsub">${esc(a.path)}</div></div>
      <div class="artmeta"><span class="artwhen">${a.action === 'created' ? '✎ created' : '✎ edited'} · ${when(a.when)}</span>
        <button class="linkb artchat">${esc(a.chat_title)} →</button></div>`;
    el.querySelector('.artchat').onclick = e => { e.stopPropagation(); openChat(a.chat_id); };
    box.appendChild(el);
  }
}
$('artSearch').addEventListener('input', drawArtifacts);
$('artTypes').querySelectorAll('button').forEach(b => b.onclick = () => {
  artType = b.dataset.t;
  $('artTypes').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  drawArtifacts();
});
$('artList').addEventListener('click', e => {
  const el = e.target.closest('.artcard'); if (!el || e.target.closest('.artchat')) return;
  openFileRef(el);
});
$('artList').addEventListener('contextmenu', e => {
  const el = e.target.closest('.artcard'); if (!el) return;
  fileMenu(e, el);
});

async function loadRoutines(list) {
  routines = list || await api().list_routines();
  const box = $('rtList'); box.innerHTML = '';
  $('routineBadge').textContent = routines.some(r => r.running) ? '● running' : '';
  if (!routines.length) {
    box.innerHTML = `<div class="rempty"><span class="eart clock"></span><div class="big">⏱</div><b>No routines yet</b><div class="vsub" style="margin:6px auto 14px">Make one to have Auoris check your projects, tidy reports, or run builds on a schedule.</div><button class="primary" id="rtEmptyNew">＋ Create your first routine</button></div>`;
    $('rtEmptyNew').onclick = () => editRoutine();
    return;
  }
  routines.forEach((r, i) => {
    const c = document.createElement('div'); c.className = 'rcard' + (r.enabled === false ? ' off' : '') + (r.running ? ' run' : ''); c.style.animationDelay = i * 40 + 'ms';
    const perm = { read: 'read-only', ai: 'AI decides', all: 'allow all' }[r.perm] || 'AI decides';
    c.innerHTML = `<div class="rn"><button class="switch ${r.enabled === false ? '' : 'on'}" title="Enable / disable"></button>${esc(r.name)}</div>
      <div class="rp">${esc(r.prompt)}</div>
      <div class="ra">${r.running ? '<button class="danger stop">■ Stop</button>' : '<button class="btn run">▶ Run now</button>'}<button class="icon edit" title="Edit">✎</button><button class="icon del" title="Delete">🗑</button></div>
      <div class="rs"><span>🗓 <b>${schedText(r)}</b></span>${r.next_run && r.enabled !== false ? `<span>next: ${when(r.next_run)}</span>` : ''}
        <span>🔒 ${perm}</span>${r.cwd ? `<span title="${esc(r.cwd)}">📂 ${esc(r.cwd.split('\\').pop())}</span>` : ''}
        ${r.running ? '<span style="color:var(--acc)"><span class="spin"></span> <span class="rlive">running…</span></span>'
          : r.last_run ? `<span>last: ${when(r.last_run)} · <span class="rstat ${r.last_status}">${r.last_status === 'ok' ? '✓ done' : r.last_status}</span></span>` : '<span>never run</span>'}
        ${r.last_chat_id && !r.running ? '<button class="linkb open">Open chat →</button>' : ''}</div>
      ${r.last_summary && !r.running ? `<div class="rsum"></div>` : ''}`;
    if (c.querySelector('.rsum')) c.querySelector('.rsum').textContent = r.last_summary;
    c.dataset.id = r.id;
    c.querySelector('.switch').onclick = async () => loadRoutines(await api().save_routine({ id: r.id, enabled: r.enabled === false }));
    const run = c.querySelector('.run'); if (run) run.onclick = async () => { const res = await api().run_routine(r.id); if (res.error) toast('Can\'t run yet', res.error); else loadRoutines(); };
    const stop = c.querySelector('.stop'); if (stop) stop.onclick = () => api().stop_routine();
    c.querySelector('.edit').onclick = () => editRoutine(r);
    c.querySelector('.del').onclick = async () => { if (await ask({ title: 'Delete routine?', html: `<b>${esc(r.name)}</b> will stop running. Its past chats stay in your history.`, ok: 'Delete', danger: true })) loadRoutines(await api().delete_routine(r.id)); };
    const open = c.querySelector('.open'); if (open) open.onclick = () => openChat(r.last_chat_id);
    box.appendChild(c);
  });
}
let editingRoutine = null;
function rtTypeChanged() { const t = $('rtType').value; $('rtTimeWrap').hidden = !['daily', 'weekdays'].includes(t); $('rtHoursWrap').hidden = t !== 'hourly'; }
$('rtType').onchange = rtTypeChanged;
function editRoutine(r) {
  editingRoutine = r || null;
  $('rtDlgTitle').textContent = r ? 'Edit routine' : 'New routine';
  const s = (r && r.schedule) || {};
  $('rtName').value = r ? r.name : ''; $('rtPrompt').value = r ? r.prompt : '';
  $('rtType').value = s.type || 'daily'; $('rtTime').value = s.time || '09:00'; $('rtHours').value = s.hours || 4;
  $('rtCwd').value = r ? (r.cwd || '') : ''; $('rtPerm').value = (r && r.perm) || 'read'; $('rtEffort').value = (r && r.effort) || 'medium'; $('rtMode').value = (r && r.mode) || '';
  fillRoutineModels(r && r.model);
  $('rtTemplates').innerHTML = r ? '' : '<span class="ulabel" style="width:100%;margin:0">Start from a template</span>' + RT_TEMPLATES.map((t, i) => `<button data-t="${i}">${esc(t.name)}</button>`).join('');
  $('rtTemplates').querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = RT_TEMPLATES[+b.dataset.t];
    $('rtName').value = t.name; $('rtPrompt').value = t.prompt.replace('%USERNAME%', (maskNames[0] || 'you'));
    $('rtType').value = t.type; if (t.time) $('rtTime').value = t.time; $('rtPerm').value = t.perm; rtTypeChanged();
  });
  rtTypeChanged(); $('rtDlg').showModal(); $('rtName').focus();
}
$('newRoutineBtn').onclick = () => editRoutine();
$('rtClose').onclick = $('rtCancel').onclick = () => $('rtDlg').close();
$('rtBrowse').onclick = async () => { const p = await api().pick_folder_path(); if (p) $('rtCwd').value = p; };
$('rtSave').onclick = async () => {
  const name = $('rtName').value.trim(), prompt = $('rtPrompt').value.trim();
  if (!name || !prompt) { toast('Almost there', 'Give the routine a name and a prompt.'); return; }
  const r = { name, prompt, perm: $('rtPerm').value, effort: $('rtEffort').value, cwd: $('rtCwd').value.trim(), model: $('rtModel').value, mode: $('rtMode').value,
    schedule: { type: $('rtType').value, time: $('rtTime').value || '09:00', hours: Math.max(1, +$('rtHours').value || 1) } };
  if (editingRoutine) r.id = editingRoutine.id; else r.enabled = true;
  loadRoutines(await api().save_routine(r)); $('rtDlg').close();
};
function routineStarted(id) { $('routineBadge').textContent = '● running'; if (view === 'routines') loadRoutines(); }
function routineStatus(id, text) { const el = document.querySelector(`.rcard[data-id="${id}"] .rlive`); if (el) el.textContent = text; }
function routineFinished(id, status, name, summary, cid) {
  $('routineBadge').textContent = '';
  toast(status === 'ok' ? `✓ ${name} finished` : `${name}: ${status}`, summary || 'Click to open the chat.', () => openChat(cid));
  if (view === 'routines') loadRoutines();
}
// ---- /agent <task>: ad-hoc background sub-tasks (same machinery as routines, just triggered on demand)
// quiet = a sub-agent the AI started itself: its tool card in the chat says so, and up to 27 toasts at once would bury the screen
function agentStarted(id, task, quiet) { if (!quiet) toast('🤖 Agent started', task.slice(0, 100)); }
function agentFinished(id, status, summary, cid, quiet) {
  if (quiet) return;
  Sfx.play('done');
  toast(status === 'ok' ? '✓ Agent finished' : `Agent ${status}`, (summary || 'Click to open the chat.').slice(0, 200), () => openChat(cid));
}

// ---- Background tasks tab: what runs now comes from the app; finished ones are kept on this PC (last 40)
const TK_KEY = 'auoris_tasks_done', tkNames = {}, tkLive = {};
let tkTimer = null;
function tkDone() { try { return JSON.parse(localStorage.getItem(TK_KEY) || '[]'); } catch (e) { return []; } }
function tkAdd(t) { const l = [t, ...tkDone()].slice(0, 40); try { localStorage.setItem(TK_KEY, JSON.stringify(l)); } catch (e) {} }
const TK_KIND = { agent: '🤖 Agent', routine: '⏱ Routine', multi: '🧩 Multi-model' };
async function tkBadge() {
  let n = 0; try { n = (await api().background_tasks()).length; } catch (e) {}
  $('taskBadge').textContent = n || '';
}
async function loadTasks() {
  clearTimeout(tkTimer);
  let run = []; try { run = await api().background_tasks(); } catch (e) {}
  $('taskBadge').textContent = run.length || '';
  $('tkRun').innerHTML = run.length ? run.map(t => `<div class="rcard run">
      <div class="rn"><span class="spin"></span> ${esc(t.name)}</div>
      <div class="rp">${esc(TK_KIND[t.kind] || t.kind)}${t.model ? ' · ' + esc(String(t.model).split('/').pop()) : ''}${tkLive[t.id] ? ' · ' + esc(tkLive[t.id]) : ''}</div>
      <div class="ra">${t.chat_id && t.kind !== 'multi' ? '<button class="btn" data-open>Open chat</button>' : ''}<button class="btn" data-stop>Stop</button></div></div>`).join('')
    : '<div class="tkempty">Nothing is running. Start one with /agent, an @agent, a routine, or /extra, /team, /divide.</div>';
  $('tkRun').querySelectorAll('.rcard').forEach((c, i) => {
    const t = run[i];
    c.querySelector('[data-stop]').onclick = e => {
      e.target.disabled = true; e.target.textContent = 'Stopping…';
      if (t.kind === 'agent') api().stop_agent_task(t.id); else if (t.kind === 'routine') api().stop_routine(); else api().stop();
    };
    const o = c.querySelector('[data-open]'); if (o) o.onclick = () => openChat(t.chat_id);
  });
  const done = tkDone();
  $('tkDone').innerHTML = done.length ? done.map((t, i) => `<div class="rcard" data-i="${i}">
      <div class="rn">${esc(t.name)}</div>
      <div class="rp">${esc(TK_KIND[t.kind] || t.kind)} · <span class="rstat ${esc(t.status)}">${esc(t.status === 'ok' ? 'finished' : t.status)}</span> · ${esc(new Date(t.at).toLocaleString())}</div>
      <div class="ra">${t.cid ? '<button class="btn" data-open>Open chat</button>' : ''}</div>
      ${t.summary ? `<div class="rsum">${esc(t.summary)}</div>` : ''}</div>`).join('')
    : '<div class="tkempty">Nothing yet.</div>';
  $('tkDone').querySelectorAll('[data-open]').forEach(b => { const t = done[+b.closest('.rcard').dataset.i]; b.onclick = () => openChat(t.cid); });
  if (!$('tasksPanel').hidden) tkTimer = setTimeout(loadTasks, 2500);
}
function tasksToggle(open) {
  const p = $('tasksPanel'); p.hidden = open === undefined ? !p.hidden : !open;
  $('tasksBtn').classList.toggle('on', !p.hidden);
  if (!p.hidden) loadTasks(); else clearTimeout(tkTimer);
}
$('tasksBtn').onclick = e => { e.stopPropagation(); tasksToggle(); };
$('tasksClose').onclick = () => tasksToggle(false);
// a press outside closes it (pointerdown, not click: picking /tasks from the slash list with the mouse ends in a click that would close it again)
document.addEventListener('pointerdown', e => { if (!$('tasksPanel').hidden && !e.target.closest('#tasksPanel, #tasksBtn')) tasksToggle(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tasksPanel').hidden) tasksToggle(false); });
$('tasksClear').onclick = () => { try { localStorage.removeItem(TK_KEY); } catch (e) {} loadTasks(); };
function tkChanged() { if (!$('tasksPanel').hidden) loadTasks(); else setTimeout(tkBadge, 50); }
{ const aS = agentStarted, aF = agentFinished, rS = routineStarted, rSt = routineStatus, rF = routineFinished, mS = multiStart, mE = multiEnd;
  agentStarted = (id, task, quiet) => { tkNames[id] = task; aS(id, task, quiet); tkChanged(); };
  agentFinished = (id, status, summary, cid, quiet) => {
    tkAdd({ kind: 'agent', name: (tkNames[id] || 'Agent task').slice(0, 120), status, summary: (summary || '').slice(0, 400), cid, at: Date.now() });
    delete tkNames[id]; delete tkLive[id]; aF(id, status, summary, cid, quiet); tkChanged();
  };
  routineStarted = id => { rS(id); tkChanged(); };
  routineStatus = (id, text) => { tkLive[id] = text; rSt(id, text); };
  routineFinished = (id, status, name, summary, cid) => {
    tkAdd({ kind: 'routine', name, status, summary: (summary || '').slice(0, 400), cid, at: Date.now() });
    delete tkLive[id]; rF(id, status, name, summary, cid); tkChanged();
  };
  multiStart = label => { mS(label); tkChanged(); };
  multiEnd = () => { const was = !!xLive; mE(); if (was) tkChanged(); };
}

// ================================================================ auto-update
let updLatest = null;
function setUpdPill(html, title) { const p = $('updPill'); p.hidden = !html; p.innerHTML = html || ''; p.title = title || ''; }
let updToasted = '';
function updateAvailable(info, canInstall) {
  updLatest = info;
  const first = updToasted !== info.version; updToasted = info.version;   // the checker repeats this every couple of minutes: say it once per version
  $('updInfo').textContent = `v${info.version} is available (you have v${prefs.version}).`;
  if (!canInstall) {
    setUpdPill(`⬇ v${esc(info.version)} available`, 'Install the new Auoris-Setup.exe to update (this copy wasn\'t installed with Setup)');
    $('updPill').onclick = () => api().open_url(info.page);
    if (first) toast(`Auoris ${info.version} is out`, 'This copy can\'t update itself — install it with Setup.');
  } else if (prefs.auto_update === false) {
    setUpdPill(`⬇ Update to v${esc(info.version)}`, 'Click to install now');
    $('updPill').onclick = () => { api().install_update(); };
    if (first) toast(`Auoris ${info.version} is available`, 'Click the green button in the top bar to install it.');
  } else if (first) toast(`Updating to Auoris ${info.version}`, 'Downloading in the background — it installs when the AI isn\'t busy.');
}
function updateProgress(ver, pct) {
  if (pct === 100) setUpdPill(`✓ v${esc(ver)} ready`, busy ? 'Installs as soon as the current reply finishes' : 'Installing…');
  else setUpdPill(`⬇ v${esc(ver)} <i><b style="width:${pct || 0}%"></b></i>`, 'Downloading update');
}
function updateInstalling(ver) { setUpdPill(`↻ Restarting…`, ''); toast(`Installing Auoris ${ver}`, 'Auoris will close and reopen in a few seconds — your chat comes back.'); }
function updateFailed(err) { setUpdPill(''); toast('Update failed', err + ' — it will try again later.'); }
$('checkUpd').onclick = async () => {
  $('updInfo').textContent = 'Checking…';
  const r = await checkForUpdates();
  $('updInfo').textContent = r.status === 'beta' ? 'Installing the latest beta…'
    : r.status === 'current' ? `You're on the latest version (v${prefs.version}).`
    : r.status === 'available' && r.revert ? `Going back to the stable release v${r.version}…`
    : r.status === 'available' ? `v${r.version} is available — ${r.can_install ? 'downloading now' : 'install it with Setup'}.`
    : r.status === 'not_configured' ? `v${prefs.version} · update server not set up yet.` : `Couldn't check: ${r.error}`;
};

// ================================================================ toasts
function toast(title, body, onclick, prof) {
  const t = document.createElement('div'); t.className = 'toast' + (prof ? ' withav' : '');
  t.innerHTML = (prof && typeof favHTML === 'function' ? favHTML(prof, 'toastav') : '') + `<span class="tbody"><b></b><div></div></span>`; t.querySelector('b').textContent = title; t.querySelector('div').textContent = body || '';
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  t.onclick = () => { if (onclick) onclick(); close(); };
  $('toasts').appendChild(t); setTimeout(close, 7000);
}

// ================================================================ slash commands
const COMMANDS = [
  { cmd: '/new', desc: 'Start a new chat', run: () => newChat() },
  { cmd: '/compact', desc: 'Compact: summarise the older part of this chat so it keeps going with less context (optionally say what to focus on)', arg: '[focus]',
    run: a => { api().compact_chat((a || '').trim()); } },
  { cmd: '/autocompact', desc: 'Autocompact: compact by itself when the chat reaches this many tokens (default 700000), or turn it off', arg: 'on | off | tokens', opts: ['on', 'off'],
    run: async a => {
      a = (a || '').trim().toLowerCase();
      if (!a) return toast('Autocompact', prefs.auto_compact === false ? 'Off' : `On, at ${(prefs.compact_tokens || 700000).toLocaleString()} tokens`);
      if (a === 'on' || a === 'off') { prefs.auto_compact = a === 'on'; await api().set_setting('auto_compact', prefs.auto_compact); return toast('Autocompact', a === 'on' ? `On, at ${(prefs.compact_tokens || 700000).toLocaleString()} tokens` : 'Off'); }
      const n = parseInt(a.replace(/[,_ ]/g, '').replace(/k$/, '000'), 10);
      if (!(n >= 2000 && n <= 5000000)) return toast('Autocompact', 'Give a number of tokens between 2,000 and 5,000,000 (for example 500000 or 500k), or on / off.');
      prefs.compact_tokens = n; prefs.auto_compact = true; await api().set_setting('compact_tokens', n); await api().set_setting('auto_compact', true);
      toast('Autocompact', `On, at ${n.toLocaleString()} tokens`);
    } },
  { cmd: '/chat', desc: 'Switch to Chat mode (no files)', run: () => document.querySelector('#modeSeg [data-mode="chat"]').click() },
  { cmd: '/code', desc: 'Switch to Code mode (files & commands)', run: () => document.querySelector('#modeSeg [data-mode="code"]').click() },
  { cmd: '/incognito', desc: 'Toggle incognito (not saved)', run: () => $('incogBtn').click() },
  { cmd: '/profile', desc: 'Edit your profile', run: () => openSettings('profile') },
  { cmd: '/lang', desc: 'Change app language', arg: Object.keys(LANGS).join(' | '), opts: Object.keys(LANGS),
    run: async a => { if (!LANGS[a]) return openSettings('general'); prefs.ui_lang = a; await api().set_setting('ui_lang', a); applyPrefs(); } },
  { cmd: '/keys', desc: 'Keyboard shortcuts', run: () => showKeys() },
  { cmd: '/explore', desc: 'Browse & download models from Hugging Face', run: () => showView('explore') },
  { cmd: '/routines', desc: 'Scheduled prompts', run: () => showView('routines') },
  { cmd: '/tasks', desc: 'Background tasks: running agents, routines and multi-model runs', run: () => tasksToggle(true) },
  { cmd: '/model', desc: 'Switch model', arg: 'name', run: a => a ? useModel(a) : $('settingsBtn').click() },
  { cmd: '/think', desc: 'Toggle Deep think', run: () => $('thinkBtn').click() },
  { cmd: '/fast', desc: 'Fast mode: lowest effort, no thinking, short answers and the fewest steps (on / off)', arg: 'on | off', opts: ['on', 'off'],
    run: a => { a = (a || '').trim().toLowerCase(); if (!a || (a === 'on') !== !!prefs.fast_mode) $('fastBtn').click(); else toast('Fast mode', prefs.fast_mode ? 'Already on' : 'Already off'); } },
  { cmd: '/effort', desc: 'Set effort (cloud models offer their own levels; Vibing is the highest)', arg: 'minimal | low | medium | high | max | vibing',
    opts: ['minimal', 'low', 'medium', 'high', 'max', 'vibing'],
    run: a => { if (!a) return; prefs.effort = a; api().set_setting('effort', a); effortFor = ''; effortMenu(); toast('Effort', a); } },
  { cmd: '/perm', desc: 'Set permissions', arg: 'ask | edits | ai | all', opts: ['ask', 'edits', 'ai', 'all'],
    run: async a => { if (!a) return; if (await choosePerm(a)) toast('Permissions', $('permSel').selectedOptions[0].text); } },
  { cmd: '/cd', desc: 'Change working folder', run: () => $('cwdBtn').click() },
  { cmd: '/regen', desc: 'Regenerate the last answer', run: () => regenerate() },
  { cmd: '/stop', desc: 'Stop the current reply', run: () => stopNow() },
  { cmd: '/usage', desc: 'Token usage & GPU memory', run: () => openUsage() },
  { cmd: '/settings', desc: 'Open settings', run: () => $('settingsBtn').click() },
  { cmd: '/hide', desc: 'Toggle hiding your username', run: () => { const on = !MASK_RE; setMask(on); $('hideUserIn').checked = on; api().set_setting('hide_username', on); toast('Hide username', on ? 'On' : 'Off'); } },
  { cmd: '/sidebar', desc: 'Show / hide the sidebar', run: () => toggleSide() },
  { cmd: '/agent', desc: 'Run a task in the background (its own chat, full tools)', arg: 'task',
    run: a => { if (!a || !a.trim()) return; api().run_agent_task(a.trim()); } },
  { cmd: '/import', desc: 'Import your chats from ChatGPT, Claude, Claude Code, Codex, Gemini CLI', run: () => importChatsDlg() },
  { cmd: '/extra', desc: 'Auoris Extra: several models answer, cross-check each other, then a verified final answer', arg: '[fast | deep | code | private] [low … vibing] prompt',
    run: a => { if (!a || !a.trim()) return multiOpen('extra'); api().extra(a.trim()); } },
  { cmd: '/team', desc: 'Team: one model plans and reviews, the selected model does the work with tools - until it\'s approved', arg: 'task',
    run: a => { if (!a || !a.trim()) return multiOpen('team'); api().multi('team', a.trim()); } },
  { cmd: '/divide', desc: 'Divide: one model plans, one works out the strategy, one does the work (set them with /dividemodels)', arg: '[plan/strategy/execution] task  (sonnet:high/fable:vibing/opus task)',
    run: a => { if (!a || !a.trim()) return; api().divide(a.trim()); } },
  { cmd: '/dividemodels', desc: 'Models for /divide: plan, strategy, execution - add :effort to any (e.g. sonnet:high, fable:vibing, opus:max)', arg: 'sonnet:high, fable:vibing, opus:max',
    run: async a => {
      a = (a || '').trim();
      if (a) await api().set_setting('divide_models', a.toLowerCase() === 'auto' ? [] : a.split(',').map(x => x.trim()).slice(0, 3));
      const r = await api().divide_info();
      if (r.error) return toast('Divide models', r.error);
      const e = k => r.roles[k + '_effort'] ? ` (${r.roles[k + '_effort']})` : '';
      toast('Divide models' + (r.custom ? '' : ' (auto)'), `Plan: ${modelLabel(r.roles.plan)}${e('plan')} · Strategy: ${modelLabel(r.roles.strategy)}${e('strategy')} · Execution: ${modelLabel(r.roles.execution)}${e('execution')}`);
    } },
  { cmd: '/split', desc: 'Split a big request into parts that different models do at the same time, then merge', arg: 'request',
    run: a => { if (!a || !a.trim()) return multiOpen('split'); api().multi('split', a.trim()); } },
  { cmd: '/debate', desc: 'Two models argue opposite sides, the selected model judges', arg: 'question',
    run: a => { if (!a || !a.trim()) return multiOpen('debate'); api().multi('debate', a.trim()); } },
  { cmd: '/auto', desc: 'Auto mode: Auoris uses /extra or /team by itself when a message looks like it needs it', arg: 'on | off', opts: ['on', 'off'],
    run: async a => { if (!a) return openUsage(); prefs.auto_mode = a === 'on'; await api().set_setting('auto_mode', prefs.auto_mode); toast('Auto mode', a === 'on' ? 'On' : 'Off'); } },
  { cmd: '/cheapreviews', desc: 'Cheaper reviews: the cheapest model does the reviewing and planning in multi-model runs', arg: 'on | off', opts: ['on', 'off'],
    run: async a => { if (!a) return openUsage(); prefs.extra_cheap_reviews = a === 'on'; await api().set_setting('extra_cheap_reviews', prefs.extra_cheap_reviews); toast('Cheaper reviews', a === 'on' ? 'On' : 'Off'); } },
  { cmd: '/agents', get desc() { return `Your @agents: saved model + instructions you can @mention in chat. With a number: how many sub-agents the AI may run at once in Code mode (now ${agentsCapWord()}; more = more cloud usage)`; },
    arg: '[number | auto | off]', run: a => a && a.trim() ? agentsSet(a) : agentsOpen() },
  { cmd: '/remember', desc: 'Save a note to auoris.md in the working folder, so the AI knows it in every later chat there', arg: 'note',
    run: async a => {
      const r = await api().auoris_md_note((a || '').trim());
      toast('Remember', r.error || 'Saved to ' + r.path + (r.long ? ' - it is over 12,000 characters now and Auoris reads only the first 12,000: tidy it with /auorismd open.' : ''));
    } },
  { cmd: '/auorismd', desc: 'auoris.md: notes and rules Auoris reads in every chat in this folder (open creates it; global = for all folders)', arg: 'open | global | list',
    opts: ['open', 'global', 'list'],
    run: async a => {
      a = (a || 'open').trim().toLowerCase();
      if (a === 'list') {
        const r = await api().auoris_md('project', 'info');
        return toast('auoris.md', r.files && r.files.length ? 'In use: ' + r.files.join(' · ') : 'None yet - /auorismd creates one in ' + r.cwd);
      }
      const r = await api().auoris_md(a === 'global' ? 'global' : 'project', 'open');
      if (r.error) return toast('auoris.md', r.error);
      toast('auoris.md', (r.created ? 'Created ' : 'Opened ') + r.path + ' - Auoris reads it at the start of every answer.');
    } },
];
let slashSel = 0, slashList = [];
// The composer's ? button: the commands worth knowing, grouped. Clicking one puts it in the message box (its options show as you type).
const CMD_HELP = [
  ['Several AIs', ['/extra', '/divide', '/team', '/split', '/debate', '/benchmark', '/mcp']],
  ['Agents and tasks', ['/agent', '/agents', '/tasks', '/routines']],
  ['How it works', ['/effort', '/think', '/model', '/perm', '/chat', '/code']],
  ['Set up', ['/dividemodels', '/auorismd', '/remember', '/usage']],
  ['Chat', ['/new', '/compact', '/autocompact', '/pets', '/stop']],
];
function cmdHelpOpen() {
  const had = document.querySelector('.pmenu.cmdhelp'); closeMenus(); if (had) return;
  const m = document.createElement('div'); m.className = 'pmenu cmdhelp';
  const by = Object.fromEntries(COMMANDS.map(c => [c.cmd, c]));
  m.innerHTML = CMD_HELP.map(([g, list]) => `<h6>${esc(g)}</h6>` + list.filter(c => by[c]).map(c =>
    `<button class="ch" data-c="${c}"><code>${c}</code><span>${esc(by[c].desc)}</span></button>`).join('')).join('') +
    '<div class="chfoot">Type <b>/</b> in the message box for every command.</div>';
  document.body.appendChild(m);
  const b = $('cmdHelpBtn').getBoundingClientRect(), z = prefs.font_scale || 1;
  m.style.left = Math.max(8, Math.min(b.left / z, innerWidth / z - 440)) + 'px'; m.style.bottom = (innerHeight / z - b.top / z + 8) + 'px'; m.style.top = 'auto';
  m.onclick = e => e.stopPropagation();
  m.querySelectorAll('.ch').forEach(x => x.onclick = () => {
    const c = by[x.dataset.c]; closeMenus();
    if (view !== 'chat') showView('chat');
    if (!c.arg) { input.value = ''; autosize(); return c.run(''); }
    input.value = c.cmd + ' '; input.focus(); input.dispatchEvent(new Event('input'));
  });
}
$('cmdHelpBtn').onclick = e => { e.stopPropagation(); cmdHelpOpen(); };
let agentCache = [];
async function agentsRefresh() { try { agentCache = await api().ai_agents(); } catch (e) { agentCache = []; } }
function slashUpdate() {
  const v = input.value, box = $('slash');
  if (/^@[\w-]*$/.test(v)) {   // @agents: the saved ones, plus @team
    const w = v.slice(1).toLowerCase();
    const all = [{ name: 'team', desc: 'Team mode: plan, do the work with tools, review until approved' }]
      .concat(agentCache.map(a => ({ name: a.name, desc: (a.tools ? '🛠 works in the background · ' : '') + modelLabel(a.model) })));
    slashList = all.filter(a => a.name.toLowerCase().startsWith(w)).map(a => ({ cmd: '@' + a.name, desc: a.desc, fill: '@' + a.name + ' ', label: '@' + a.name, run: () => {} }));
    if (!slashList.length) { box.classList.remove('on'); return; }
    slashSel = Math.min(slashSel, slashList.length - 1);
    box.innerHTML = `<div class="schead"><span>Agents</span><span>Tab complete · /agents to edit</span></div>` +
      slashList.map((c, i) => `<div class="sc ${i === slashSel ? 'sel' : ''}" data-i="${i}"><b>${esc(c.label)}</b><span>${esc(c.desc)}</span></div>`).join('');
    box.querySelectorAll('.sc').forEach(el => { el.onmousedown = e => { e.preventDefault(); input.value = slashList[+el.dataset.i].fill; box.classList.remove('on'); input.focus(); }; });
    box.classList.add('on');
    return;
  }
  if (!v.startsWith('/') || v.includes('\n')) { box.classList.remove('on'); slashList = []; return; }
  const [word, ...rest] = v.split(' '), arg = rest.join(' ').trim().toLowerCase();
  const exact = COMMANDS.find(c => c.cmd === word.toLowerCase());
  if (exact && rest.length && exact.opts) slashList = exact.opts.filter(o => o.startsWith(arg)).map(o => ({ ...exact, fill: `${exact.cmd} ${o}`, label: `${exact.cmd} ${o}` }));
  else if (exact && rest.length) slashList = [{ ...exact, fill: v, label: v }];
  else slashList = COMMANDS.filter(c => c.cmd.startsWith(word.toLowerCase())).map(c => ({ ...c, fill: c.cmd + (c.arg ? ' ' : ''), label: c.cmd }));
  if (!slashList.length) { box.classList.remove('on'); return; }
  slashSel = Math.min(slashSel, slashList.length - 1);
  box.innerHTML = `<div class="schead"><span>Commands</span><span>↑↓ choose · Tab complete · Enter run · Esc close</span></div>` +
    slashList.map((c, i) => `<div class="sc ${i === slashSel ? 'sel' : ''}" data-i="${i}"><b>${esc(c.label)}</b><span>${esc(c.desc)}</span>${c.arg ? `<small>${esc(c.arg)}</small>` : ''}</div>`).join('');
  box.querySelectorAll('.sc').forEach(el => {
    el.onmouseenter = () => { slashSel = +el.dataset.i; box.querySelectorAll('.sc').forEach(x => x.classList.toggle('sel', x === el)); };
    el.onmousedown = e => { e.preventDefault(); slashSel = +el.dataset.i; slashRun(); };
  });
  box.classList.add('on');
  box.querySelector('.sc.sel')?.scrollIntoView({ block: 'nearest' });
}
function slashRun() {
  const c = slashList[slashSel]; if (!c) return;
  if (c.cmd && c.cmd.startsWith('@')) { input.value = c.fill; $('slash').classList.remove('on'); slashList = []; return; }
  if (c.arg && !c.fill.trim().includes(' ') && c.opts) { input.value = c.fill; slashUpdate(); return; }  // needs an argument: complete first
  const arg = (c.fill.trim().split(' ').slice(1).join(' ') || '').trim();
  input.value = ''; autosize(); $('slash').classList.remove('on'); slashList = [];
  c.run(arg);
}
input.addEventListener('input', () => { if (window.histQuiet) return; slashSel = 0; slashUpdate(); });
input.addEventListener('keydown', e => {
  if (!$('slash').classList.contains('on')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); slashSel = (slashSel + 1) % slashList.length; slashUpdate(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = (slashSel - 1 + slashList.length) % slashList.length; slashUpdate(); }
  else if (e.key === 'Tab') { e.preventDefault(); input.value = slashList[slashSel].fill; slashUpdate(); }
  else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); slashRun(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('slash').classList.remove('on'); }
}, true);
input.addEventListener('blur', () => setTimeout(() => $('slash').classList.remove('on'), 150));

// ---- Up/Down arrow in a message box walks back through what you sent (like a terminal): Up on an empty box brings
// back your last message, keep pressing for older ones, Down comes forward again and finally back to what you were typing.
(() => {
  const SEL = '#input, #chatInput, #svChatInput, #grChatInput, #prChatInput';
  const hist = new Map();
  let quiet = false;
  const keyOf = el => (el.id || 'composer') + '@' + (el.placeholder || '') + '@' + (el.id === 'chatInput' && typeof activeChat !== 'undefined' ? activeChat : '');
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
  const setVal = (el, v) => { quiet = window.histQuiet = true; el.value = v; el.setSelectionRange(v.length, v.length); el.dispatchEvent(new Event('input', { bubbles: true })); quiet = window.histQuiet = false; };
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
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#sendBtn')) { const el = document.querySelector('#input'); if (el) note(el); } }, true);
})();

// ================================================================ extras: prompt library, personas, compare, read aloud, folder chat, export
// (self-contained section: Api methods live in app.py under "extras"; user text is always esc()'d or set via textContent)
let xLastAsst = null, xExt = { persona: null, folder: null }, xPersonaNames = [];

// ---- chips near the model chip (persona + folder)
async function xRefreshExt() {
  try { xExt = await api().chat_ext_state(); } catch (e) { return; }
  xPaintExt();
}
function xPaintExt() {
  const pc = $('personaChip'), fc = $('folderChip');
  pc.hidden = !xExt.persona;
  if (xExt.persona) { pc.querySelector('.xcn').textContent = xExt.persona.name; pc.title = 'Persona for this chat: ' + xExt.persona.name + '\nClick to change or turn it off'; }
  fc.hidden = !xExt.folder;
  if (xExt.folder) {
    const f = xExt.folder;
    fc.querySelector('.xcn').textContent = f.root.split(/[\\/]/).filter(Boolean).pop() || f.root;
    fc.title = `Chatting with folder ${f.root}\n${f.files} files indexed (keyword search, not embeddings)\nClick for details or to turn it off`;
  }
}
$('personaChip').onclick = e => { e.stopPropagation(); xPersonaMenu($('personaChip')); };
$('folderChip').onclick = e => { e.stopPropagation(); xFolderOpen(); };

// ---- personas
async function xPersonaMenu(anchor) {
  closeMenus();
  const list = await api().personas_list();
  xPersonaNames = list.map(p => p.name.toLowerCase());
  const m = document.createElement('div'); m.className = 'pmenu xpm';
  const curId = xExt.persona ? xExt.persona.id : '';
  m.innerHTML = `<div class="mh"><div><b>Persona for this chat</b><small>Added after your custom instructions</small></div></div>` +
    `<button class="mi ${curId ? '' : 'cur'}" data-id="">None</button>` +
    list.map(p => `<button class="mi ${p.id === curId ? 'cur' : ''}" data-id="${esc(p.id)}" title="${esc(p.text.slice(0, 200))}">${esc(p.name)}</button>`).join('') +
    `<div class="sep2"></div><button class="mi" data-manage><span class="i">⚙</span>Manage personas…</button>`;
  document.body.appendChild(m);
  const a = (anchor && !anchor.hidden ? anchor : $('modelChip')).getBoundingClientRect(), z = prefs.font_scale || 1;
  m.style.left = Math.max(8, a.left / z) + 'px'; m.style.bottom = (innerHeight / z - a.top / z + 8) + 'px'; m.style.top = 'auto';
  m.onclick = e => e.stopPropagation();
  m.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { closeMenus(); xSetPersona(b.dataset.id); });
  m.querySelector('[data-manage]').onclick = () => { closeMenus(); openSettings('personas'); xPerDraw(); };
}
async function xSetPersona(id) {
  xExt = await api().persona_set(id); xPaintExt();
  toast('Persona', xExt.persona ? xExt.persona.name + ' is on for this chat' : 'Off for this chat');
}
let xPerEdit = null;
async function xPerDraw() {
  const list = await api().personas_list();
  xPersonaNames = list.map(p => p.name.toLowerCase());
  $('xPerList').innerHTML = list.length ? list.map(p => `<div class="xitem ${xExt.persona && xExt.persona.id === p.id ? 'on' : ''}" data-id="${esc(p.id)}"><div class="xt"><b>${esc(p.name)}</b><small>${esc(p.text.replace(/\s+/g, ' ').slice(0, 90))}</small></div>` +
    `<button class="btn sm" data-a="use">Use in this chat</button><button class="btn sm" data-a="edit">Edit</button><button class="btn sm" data-a="del">✕</button></div>`).join('')
    : '<div class="xempty">No personas yet. Add one below.</div>';
  $('xPerList').querySelectorAll('.xitem').forEach(row => {
    const p = list.find(x => x.id === row.dataset.id);
    row.querySelector('[data-a="use"]').onclick = async () => { await xSetPersona(p.id); xPerDraw(); };
    row.querySelector('[data-a="edit"]').onclick = () => { xPerEdit = p.id; $('xPerName').value = p.name; $('xPerText').value = p.text; };
    row.querySelector('[data-a="del"]').onclick = async () => {
      if (!await ask({ title: 'Delete persona?', html: `<b>${esc(p.name)}</b> will be deleted.`, ok: 'Delete', danger: true })) return;
      await api().persona_delete(p.id); if (xPerEdit === p.id) { xPerEdit = null; $('xPerName').value = $('xPerText').value = ''; }
      await xRefreshExt(); xPerDraw();
    };
  });
}
$('xPerSave').onclick = async () => {
  const r = await api().persona_save(xPerEdit, $('xPerName').value, $('xPerText').value);
  if (!r.ok) { toast('Persona', r.error); return; }
  xPerEdit = null; $('xPerName').value = $('xPerText').value = ''; await xRefreshExt(); xPerDraw(); toast('Persona', 'Saved');
};
$('xPerNew').onclick = () => { xPerEdit = null; $('xPerName').value = $('xPerText').value = ''; $('xPerName').focus(); };
document.querySelector('.settabs [data-tab="personas"]').addEventListener('click', xPerDraw);

// ---- prompt library
let xPrEdit = null;
async function xPromptsOpen() {
  xPrEdit = null; $('xPrName').value = $('xPrText').value = '';
  $('xPromptDlg').showModal();
  await xPrDraw();
}
async function xPrDraw() {
  const list = await api().prompts_list();
  $('xPrList').innerHTML = list.length ? list.map(p => `<div class="xitem" data-id="${esc(p.id)}"><div class="xt"><b>${esc(p.name)}</b><small>${esc(p.text.replace(/\s+/g, ' ').slice(0, 90))}</small></div>` +
    `<button class="btn sm" data-a="ins">Insert</button><button class="btn sm" data-a="edit">Edit</button><button class="btn sm" data-a="del">✕</button></div>`).join('')
    : '<div class="xempty">No saved prompts yet. Type one in the message box and press "Use the message box text", or write one below.</div>';
  $('xPrList').querySelectorAll('.xitem').forEach(row => {
    const p = list.find(x => x.id === row.dataset.id);
    row.querySelector('[data-a="ins"]').onclick = () => {
      input.value = input.value.trim() ? input.value.replace(/\s+$/, '') + '\n' + p.text : p.text;
      autosize(); $('xPromptDlg').close(); input.focus();
    };
    row.querySelector('[data-a="edit"]').onclick = () => { xPrEdit = p.id; $('xPrName').value = p.name; $('xPrText').value = p.text; };
    row.querySelector('[data-a="del"]').onclick = async () => {
      if (!await ask({ title: 'Delete prompt?', html: `<b>${esc(p.name)}</b> will be deleted.`, ok: 'Delete', danger: true })) return;
      await api().prompt_delete(p.id); if (xPrEdit === p.id) { xPrEdit = null; $('xPrName').value = $('xPrText').value = ''; }
      xPrDraw();
    };
  });
}
$('xPrSave').onclick = async () => {
  const r = await api().prompt_save(xPrEdit, $('xPrName').value, $('xPrText').value);
  if (!r.ok) { toast('Prompt library', r.error); return; }
  xPrEdit = null; $('xPrName').value = $('xPrText').value = ''; xPrDraw(); toast('Prompt library', 'Saved');
};
$('xPrNew').onclick = () => { xPrEdit = null; $('xPrName').value = $('xPrText').value = ''; $('xPrName').focus(); };
$('xPrFromInput').onclick = () => {
  if (!input.value.trim()) { toast('Prompt library', 'The message box is empty.'); return; }
  $('xPrText').value = input.value; if (!$('xPrName').value) { $('xPrName').value = input.value.trim().split('\n')[0].slice(0, 40); $('xPrName').select(); }
};
$('xPrClose').onclick = () => $('xPromptDlg').close();
$('xPromptDlg').onclick = e => { if (outside($('xPromptDlg'), e)) $('xPromptDlg').close(); };
$('setPrompts').onclick = xPromptsOpen;

// ---- Auoris Pets (pets.py): companions that read your prompt before it is sent, and remember only what you let them
const PET_KINDS = ['dog', 'cat', 'parrot', 'fish'];
const call = { on: false, pending: null, timer: null, ask: null, who: '', dog: null };   // a voice call (see callStart)
let petState = null, petBusy = false, petView = { screen: 'home', kind: '', tab: 'profile' };
const petImgCache = {};
async function petImage(k) { if (!petImgCache[k]) { try { petImgCache[k] = await api().pets_image(k); } catch (e) { petImgCache[k] = ''; } } return petImgCache[k]; }
function petPaintImgs(root) { (root || document).querySelectorAll('img[data-pet]').forEach(async im => { const u = await petImage(im.dataset.pet); if (u) im.src = u; }); }
async function petRefresh() { try { petState = await api().pets_state(); } catch (e) { petState = null; } petChipPaint(); return petState; }
function petActive() {
  const s = petState; if (!s || !s.ack) return null;
  const k = s.active && s.pets[s.active] && s.pets[s.active].enabled ? s.active : s.auto_pick ? PET_KINDS.find(x => s.pets[x] && s.pets[x].enabled) : null;
  return k ? Object.assign({ kind: k }, s.pets[k]) : null;
}
async function petChipPaint(thinking) {
  const p = petActive(), chip = $('petChip');
  chip.hidden = !p;
  if (!p) return;
  const u = await petImage(p.kind); if (u) $('petChipImg').src = u;
  chip.querySelector('.xcn').textContent = thinking ? p.name + ' is reading…' : p.name;
  chip.classList.toggle('petthink', !!thinking);
}
$('petChip').onclick = () => petsOpen();
$('petsBtn').onclick = () => petsOpen();

const petModelLabel = m => !m ? 'Same as the chat model' : modelLabel(m);
async function petModelOptions(sel) {
  let d = { local: [], cloud: [] }; try { d = await api().models_all(); } catch (e) {}
  const opt = (v, l) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`;
  let h = opt('', 'Same as the chat model');
  if (d.local.length) h += `<optgroup label="On this PC">${d.local.map(n => opt(n, modelLabel(n))).join('')}</optgroup>`;
  for (const g of d.cloud) if (g.models.length) h += `<optgroup label="${esc(g.name)} (cloud)">${g.models.map(m => opt(m.value, m.name !== m.id ? m.name : m.id)).join('')}</optgroup>`;
  return h;
}
const petCost = i => i.plan ? 'covered by your plan' : i.cost === 0 ? 'free (runs on this PC)' : i.cost == null ? 'cost unknown (no price listed)' : '≈ ' + money(i.cost) + ' per analysed prompt';
function petWarning(info) {
  return `<div class="petwarn"><b>Before you switch a pet on</b><ul>
    <li>Each time you send a prompt, your pet reads it first with its own AI call. That is <b>extra usage</b> on top of your chat: about 650 tokens in and 250 out, ${esc(petCost(info))}.</li>
    <li>What is sent: the text of your draft prompt and up to 8 memories that look relevant. Nothing else from your chat, no files, no tools. It goes to <b>${esc(info.where)}</b>${info.cloud ? ' and is handled under that provider\'s own policies and retention rules' : ' and stays on this PC'}.</li>
    <li>Short messages and commands are skipped. Learning is optional, and you can switch any pet off with the switch on its card.</li>
    <li>With Auto-pick, the pet whose focus fits your message reads it (decided on this PC from its words). A second opinion sends the prompt to a second pet's model too.</li>
    <li>Memories are stored on this PC only. You can see, correct, export or delete every one.</li></ul></div>`;
}
async function petsOpen(kind) {
  await petRefresh();
  petView = kind ? { screen: 'pet', kind, tab: 'chat' } : { screen: 'home', kind: '', tab: 'profile' };
  $('petsDlg').showModal(); petsRender();
}
async function petsRender() {
  const box = $('petsBody'), s = petState; if (!s) { box.innerHTML = '<div class="vsub">Pets couldn\'t load.</div>'; return; }
  if (petView.screen === 'create') return petsCreateView(box);
  if (petView.screen === 'pet' && s.pets[petView.kind]) return petsPetView(box);
  petView = { screen: 'home', kind: '', tab: 'profile' };
  box.innerHTML = `<div class="xnote">Up to four companions, one of each kind. Before each prompt is sent, one of them (or two, with a second opinion) reads it, points out what's missing, and (only if learning is on) remembers things about you that you can always see and change. Nothing is learned unless you allow it, and analysing costs extra AI usage.</div>
    ${PET_KINDS.some(k => s.pets[k]) ? `<div class="petopts">
      <label class="chk"><input type="checkbox" id="poAuto" ${s.auto_pick ? 'checked' : ''}> <span><b>Auto-pick</b> - the pet that fits each message reads it (code and plans: fish, writing: parrot, checking: cat, messages and advice: dog). Otherwise your default pet. No extra cost.</span></label>
      <label>Second opinion <select id="poSecond"><option value="">Off</option>${PET_KINDS.filter(k => s.pets[k]).map(k => `<option value="${k}" ${s.second === k ? 'selected' : ''}>${esc(s.pets[k].name)}</option>`).join('')}</select></label>
      <div class="vsub">This pet also reads every message, at the same time, and you get both pets' advice together. It uses twice the AI usage.</div></div>` : ''}
    <div class="petgrid">${PET_KINDS.map(k => {
      const p = s.pets[k], d = s.defaults[k];
      return `<div class="petcard ${p ? '' : 'empty'} ${s.active === k ? 'on' : ''} ${p && !p.enabled ? 'off' : ''}" data-k="${k}">
        ${p ? `<button class="switch petsw ${p.enabled ? 'on' : ''}" title="${p.enabled ? 'Switch ' + esc(p.name) + ' off' : 'Switch ' + esc(p.name) + ' on'}"></button>` : ''}
        <img data-pet="${k}" alt="${esc(d.label)}">
        <b>${p ? esc(p.name) : esc(d.label)}</b><small>${esc(d.trait)}</small>
        ${p ? `<span class="petmeta">${esc(petModelLabel(p.model))} · ${p.memories} memor${p.memories === 1 ? 'y' : 'ies'}${s.active === k ? ` · <em>${s.auto_pick ? 'default' : 'active'}</em>` : ''}${s.second === k ? ' · <em>second opinion</em>' : ''}${p.enabled ? '' : ' · off'}</span>` : '<span class="petmeta">Not adopted yet</span>'}
        <div class="petbtns">${p ? `<button class="btn petopen">Open</button>${s.active === k ? '' : `<button class="btn petact">${s.auto_pick ? 'Make default' : 'Make active'}</button>`}` : '<button class="primary petadopt">Adopt</button>'}</div></div>`;
    }).join('')}</div>`;
  petPaintImgs(box);
  if ($('poAuto')) $('poAuto').onchange = async () => { await api().pets_options($('poAuto').checked, ''); await petRefresh(); petsRender(); };
  if ($('poSecond')) $('poSecond').onchange = async () => { await api().pets_options(null, $('poSecond').value || null); await petRefresh(); petsRender(); };
  box.querySelectorAll('.petcard').forEach(el => {
    const k = el.dataset.k;
    const a = el.querySelector('.petadopt'), o = el.querySelector('.petopen'), m = el.querySelector('.petact');
    if (a) a.onclick = () => { petView = { screen: 'create', kind: k, tab: 'profile' }; petsRender(); };
    if (o) o.onclick = () => { petView = { screen: 'pet', kind: k, tab: 'chat' }; petsRender(); };
    if (m) m.onclick = async () => { await api().pets_active(k); await petRefresh(); petsRender(); };
    const sw = el.querySelector('.petsw');
    if (sw) sw.onclick = async () => { await api().pets_update(k, { enabled: !s.pets[k].enabled }); await petRefresh(); petsRender(); };
  });
}
async function petsCreateView(box) {
  const k = petView.kind, d = petState.defaults[k], info = petState.chat_model;
  box.innerHTML = `<div class="pethead"><img data-pet="${k}" alt=""><div><h3 style="margin:0">Adopt a ${esc(d.label.toLowerCase())}</h3><div class="vsub">${esc(d.trait)}</div></div></div>
    <label>Name</label><input id="pcName" maxlength="24" value="${esc(d.label === 'Fish' ? 'Bubbles' : d.label === 'Cat' ? 'Mimi' : d.label === 'Dog' ? 'Rex' : 'Kiwi')}">
    <label>AI model for its analysis</label><select id="pcModel" class="setsel"></select>
    <label>Personality (you can change it any time)</label><textarea id="pcPers" rows="3" maxlength="600">${esc(d.personality)}</textarea>
    <div class="rtgrid"><div><label>When it has a suggestion</label><select id="pcMode" class="setsel"><option value="ask">Ask first: show me, let me approve or edit</option><option value="automatic">Automatic: apply improvements for me</option><option value="analyze">Analyze only: suggestions, never change my prompt</option></select></div>
      <div><label>Learning</label><label class="chk"><input type="checkbox" id="pcLearn" checked> <span>Let it learn from my prompts</span></label></div></div>
    <div id="pcWarn"></div>
    ${petState.ack ? '' : '<label class="chk"><input type="checkbox" id="pcAck"> <span>I understand this uses extra AI usage and what is sent where.</span></label>'}
    <div class="row"><button class="primary" id="pcGo">Adopt</button><button class="btn" id="pcBack">Back</button><span class="vsub" id="pcMsg"></span></div>`;
  petPaintImgs(box);
  $('pcModel').innerHTML = await petModelOptions('');
  const warn = async () => { const m = $('pcModel').value; $('pcWarn').innerHTML = petWarning(m ? await api().pets_model_info(m) : info); };
  $('pcModel').onchange = warn; warn();
  $('pcBack').onclick = () => { petView = { screen: 'home', kind: '', tab: 'profile' }; petsRender(); };
  $('pcGo').onclick = async () => {
    if (!petState.ack && !$('pcAck').checked) { $('pcMsg').textContent = 'Please tick the box first.'; return; }
    const r = await api().pets_create(k, $('pcName').value, $('pcModel').value, $('pcPers').value, $('pcMode').value, $('pcLearn').checked, true);
    if (!r.ok) { $('pcMsg').textContent = r.error; return; }
    await petRefresh(); petView = { screen: 'pet', kind: k, tab: 'profile' }; petsRender();
    toast('Pets', 'Welcome home!');
  };
}
function petsPetView(box) {
  const k = petView.kind, p = petState.pets[k], d = petState.defaults[k], s = petState, tab = petView.tab;
  box.innerHTML = `<div class="pethead"><img data-pet="${k}" alt=""><div style="flex:1"><h3 style="margin:0">${esc(p.name)} <small class="vsub">the ${esc(d.label.toLowerCase())}${s.active === k ? ' · active' : ''}</small></h3>
      <div class="vsub">${p.enabled ? (p.learn ? 'Learning is on' : 'Learning is off') : 'Switched off'} · ${p.memories} memor${p.memories === 1 ? 'y' : 'ies'} · ${p.today} analysed today</div></div>
      <button class="btn" id="ppBack">All pets</button></div>
    <div class="utabs" id="ppTabs"><button data-t="chat" class="${tab === 'chat' ? 'on' : ''}">Chat</button><button data-t="profile" class="${tab === 'profile' ? 'on' : ''}">Profile</button><button data-t="memory" class="${tab === 'memory' ? 'on' : ''}">Memory</button><button data-t="activity" class="${tab === 'activity' ? 'on' : ''}">Activity</button></div>
    <div id="ppPane"></div>`;
  petPaintImgs(box);
  $('ppBack').onclick = () => { petView = { screen: 'home', kind: '', tab: 'profile' }; petsRender(); };
  box.querySelectorAll('#ppTabs button').forEach(b => b.onclick = () => { petView.tab = b.dataset.t; petsPetView(box); });
  if (tab === 'memory') petsMemoryPane(k); else if (tab === 'activity') petsActivityPane(k); else if (tab === 'chat') petsChatPane(k); else petsProfilePane(k);
}
async function petsProfilePane(k) {
  const p = petState.pets[k], pane = $('ppPane'), info = p.info;
  pane.innerHTML = `<label>Name</label><input id="ppName" maxlength="24" value="${esc(p.name)}">
    <label>AI model for its analysis</label><select id="ppModel" class="setsel"></select>
    <div class="vsub">Runs on <b>${esc(info.where)}</b> · ${esc(petCost(info))}${info.supports === 'limited' ? ' · <span style="color:var(--err)">a very small model may not follow the format well</span>' : ' · supports the pet\'s features'}</div>
    <label>Personality</label><textarea id="ppPers" rows="3" maxlength="600">${esc(p.personality)}</textarea>
    <div class="rtgrid"><div><label>When it has a suggestion</label><select id="ppMode" class="setsel"><option value="ask">Ask first</option><option value="automatic">Automatic</option><option value="analyze">Analyze only</option></select></div>
      <div><label>Most prompts it may analyse per day</label><input id="ppCap" type="number" min="0" max="5000" value="${p.daily_cap}"></div></div>
    <label>How hard it thinks <small class="vsub">(lower = answers in seconds, higher = slower and more careful)</small></label>
    <select id="ppEffort" class="setsel"><option value="minimal">Fastest (recommended)</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Max</option><option value="">The model's own default (slowest)</option></select>
    <label class="chk"><input type="checkbox" id="ppLearn" ${p.learn ? 'checked' : ''}> <span>Learn from my prompts</span></label>
    <label class="chk"><input type="checkbox" id="ppOn" ${p.enabled ? 'checked' : ''}> <span>Switched on (reads my prompts when it is the active pet)</span></label>
    <div class="row"><button class="primary" id="ppSave">Save</button>${petState.active === k ? '' : '<button class="btn" id="ppAct">Make active</button>'}<button class="dangerbtn" id="ppDel">Delete ${esc(p.name)}</button><span class="vsub" id="ppMsg"></span></div>
    <details class="petsec"><summary>What is sent and where</summary>${petWarning(info)}</details>`;
  $('ppModel').innerHTML = await petModelOptions(p.model || ''); $('ppMode').value = p.mode; $('ppEffort').value = p.effort;
  $('ppSave').onclick = async () => {
    const r = await api().pets_update(k, { name: $('ppName').value, model: $('ppModel').value, personality: $('ppPers').value, mode: $('ppMode').value, effort: $('ppEffort').value, learn: $('ppLearn').checked, enabled: $('ppOn').checked, daily_cap: $('ppCap').value });
    if (!r.ok) { $('ppMsg').textContent = r.error; return; }
    await petRefresh(); petsPetView($('petsBody')); toast('Pets', 'Saved');
  };
  if ($('ppAct')) $('ppAct').onclick = async () => { await api().pets_active(k); await petRefresh(); petsPetView($('petsBody')); };
  $('ppDel').onclick = async () => {
    if (!await ask({ title: 'Delete ' + p.name + '?', html: 'This deletes the pet and everything it has learned about you. You can adopt a new one afterwards.', ok: 'Delete', danger: true })) return;
    await api().pets_delete(k); await petRefresh(); petView = { screen: 'home', kind: '', tab: 'profile' }; petsRender();
  };
}
const MEM_LABEL = { explicit: 'You said it', observed: 'Seen repeatedly', inferred: 'A guess' };
async function petsMemoryPane(k) {
  const pane = $('ppPane'), p = petState.pets[k];
  const mem = await api().pets_memories(k), hist = await api().pets_history(k);
  const order = { explicit: 0, observed: 1, inferred: 2 };
  mem.sort((a, b) => order[a.type] - order[b.type] || b.updated - a.updated);
  pane.innerHTML = `<div class="xnote">Everything ${esc(p.name)} knows about you. Each memory is <b>explicit</b> (you said it), <b>observed</b> (seen in repeated prompts) or just a <b>guess</b>. What you correct or add yourself always wins over a guess.</div>
    <div class="row"><input id="pmAdd" placeholder="Tell ${esc(p.name)} something to remember (e.g. I prefer short answers)" style="flex:1"><button class="btn" id="pmAddBtn">Add</button></div>
    <div id="pmList">${mem.length ? mem.map(m => `<div class="pmem" data-id="${esc(m.id)}"><span class="pmbadge ${m.type}">${esc(MEM_LABEL[m.type])}</span>
      <span class="pmtext">${esc(m.text)}</span><span class="pmconf" title="Confidence ${Math.round(m.confidence * 100)}%"><i style="width:${Math.round(m.confidence * 100)}%"></i></span>
      <button class="btn sm pmedit">Edit</button><button class="btn sm pmdel">Delete</button>
      <details class="pmev"><summary>Why does it think this?</summary>${(m.evidence || []).length ? (m.evidence || []).map(e => `<div>${esc(e)}</div>`).join('') : '<div>No note was kept.</div>'}<div class="vsub">First noted ${esc(new Date(m.created * 1000).toLocaleDateString())} · seen ${m.seen || 1}×</div></details></div>`).join('')
      : '<div class="vsub">Nothing learned yet.</div>'}</div>
    <div class="row"><button class="btn" id="pmExport">Export (JSON)</button><button class="dangerbtn" id="pmReset">Delete all memories</button></div>
    <details class="petsec"><summary>Learning history (${hist.length})</summary>${hist.map(h => `<div class="pmh"><small>${esc(new Date(h.t * 1000).toLocaleString())}</small> <b>${esc(h.event)}</b> ${esc(h.text)}</div>`).join('') || '<div class="vsub">Nothing yet.</div>'}</details>`;
  const again = async () => { await petRefresh(); petsMemoryPane(k); };
  $('pmAddBtn').onclick = async () => { const t = $('pmAdd').value.trim(); if (!t) return; const r = await api().pets_memory_add(k, t); if (!r.ok) { toast('Pets', r.error); return; } again(); };
  pane.querySelectorAll('.pmem').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.pmdel').onclick = async () => { await api().pets_memory_delete(k, id); again(); };
    el.querySelector('.pmedit').onclick = () => {
      const span = el.querySelector('.pmtext'), cur = span.textContent;
      span.innerHTML = `<input class="pmin" maxlength="200" value="${esc(cur)}"><button class="btn sm pmok">Save</button>`;
      span.querySelector('.pmok').onclick = async () => { const r = await api().pets_memory_edit(k, id, span.querySelector('.pmin').value); if (!r.ok) { toast('Pets', r.error); return; } again(); };
    };
  });
  $('pmExport').onclick = async () => {
    const r = await api().save_json_export(p.name + '-memories', await api().pets_export(k));   // the desktop window has no browser downloads
    if (r && r.ok) toast('Pets', 'Saved to ' + r.path); else if (r && r.error) toast('Pets', r.error);
  };
  $('pmReset').onclick = async () => {
    if (!await ask({ title: 'Delete all of ' + p.name + '\'s memories?', html: 'It forgets everything it learned about you, and the prompts saved in its recent activity. This can\'t be undone.', ok: 'Delete all', danger: true })) return;
    await api().pets_reset(k); again();
  };
}
async function petsActivityPane(k) {
  const pane = $('ppPane'), p = petState.pets[k], an = await api().pets_analyses(k);
  pane.innerHTML = `<div class="ucards"><div class="ucard"><div class="ulabel">Today</div><div class="ubig">${p.today}</div><div class="usub">of ${p.daily_cap} allowed</div></div>
      <div class="ucard"><div class="ulabel">All time</div><div class="ubig">${p.calls}</div><div class="usub">analysed prompts</div></div>
      <div class="ucard"><div class="ulabel">Extra tokens</div><div class="ubig">${fk(Math.round(p.tin + p.tout))}</div><div class="usub">${fk(Math.round(p.tin))} in · ${fk(Math.round(p.tout))} out (estimate)</div></div></div>
    <div class="ulabel" style="margin-top:12px">Recent analyses</div>
    ${an.length ? an.map(a => `<details class="petan"><summary>${esc(new Date(a.t * 1000).toLocaleString())} · ${esc(a.outcome || (a.enhanced ? 'no decision' : 'no changes'))} · ${esc(a.original.slice(0, 60))}${a.original.length > 60 ? '…' : ''}</summary>
      <div class="pacols"><div><label>Your prompt</label><div class="pabox">${esc(a.original)}</div></div><div><label>Improved</label><div class="pabox">${a.enhanced ? esc(a.enhanced) : '<span class="vsub">Left as it was.</span>'}</div></div></div>
      ${(a.missing || []).length ? '<div class="vsub">Missing: ' + a.missing.map(esc).join('; ') + '</div>' : ''}${(a.learned || []).length ? '<div class="vsub">Learned: ' + a.learned.map(esc).join('; ') + '</div>' : ''}</details>`).join('') : '<div class="vsub">Nothing analysed yet.</div>'}`;
}
$('petsClose').onclick = () => $('petsDlg').close();
$('petsDlg').onclick = e => { if (outside($('petsDlg'), e)) $('petsDlg').close(); };

// before a message is sent: the active pet reads it. It never blocks for long, never loses the message, and "ask first" shows both versions.
function petAsk(r, original) {
  return new Promise(res => {
    const d = $('petAskDlg');
    const many = (r.by || []).length > 1;
    $('paTitle').textContent = r.name + (many ? ' have suggestions' : ' has a suggestion');
    const list = (t, a) => a && a.length ? `<div><b>${t}</b><ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const one = x => list('Missing', x.missing) + list('Doesn\'t add up', x.contradictions) + list('Ideas', x.suggestions);
    $('paAdvice').innerHTML = many ? r.by.map(x => `<div class="paby"><b>${esc(x.name)}</b>${one(x) || '<div class="vsub">Looks clear.</div>'}</div>`).join('') : one(r);
    $('paOrig').value = original; $('paNew').value = r.enhanced;
    $('paLearn').textContent = r.learned.length ? 'Learned: ' + r.learned.join('; ') : '';
    const done = v => { d.close(); res(v); };
    $('paUse').onclick = () => { const t = $('paNew').value.trim(); done({ action: t === r.enhanced ? 'applied' : 'edited', text: t || original }); };
    $('paOrigBtn').onclick = () => done({ action: 'sent-original', text: original });
    $('paCancel').onclick = () => done(null);
    d.oncancel = () => res(null);
    d.showModal();
  });
}
function petNote(r, kind, original, sent) {
  const el = document.createElement('div'); el.className = 'petnote';
  const head = kind === 'improved' ? `${esc(r.name)} improved your prompt` : kind === 'tips' ? `${esc(r.name)} ${(r.by || []).length > 1 ? 'have' : 'has'} ideas for next time` : `${esc(r.name)} learned something`;
  el.innerHTML = `<img data-pet="${esc(r.kind)}" alt=""><div><b>${head}</b>
    ${kind === 'improved' ? '<details><summary>Compare</summary><div class="pacols"><div><label>You wrote</label><div class="pabox">' + esc(original) + '</div></div><div><label>Sent</label><div class="pabox">' + esc(sent) + '</div></div></div></details>' : ''}
    ${(r.missing || []).length || (r.suggestions || []).length ? '<ul>' + [...(r.missing || []), ...(r.suggestions || [])].slice(0, 5).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}
    ${(r.learned || []).length ? '<div class="vsub">Learned: ' + r.learned.map(esc).join('; ') + ' · <a href="#" class="petmem">see memories</a></div>' : ''}
    ${kind === 'improved' ? '<button class="btn sm petundo">Resend my original</button>' : ''}</div>`;
  log.appendChild(el); petPaintImgs(el); scroll();
  const u = el.querySelector('.petundo'); if (u) u.onclick = () => { u.disabled = true; api().pet_outcome(r.ids, 'sent-original'); api().send(original); };
  const m = el.querySelector('.petmem'); if (m) m.onclick = e => { e.preventDefault(); petsOpen(r.kind).then(() => { petView.tab = 'memory'; petsRender(); }); };
}
// "Analyze only" never changes the prompt, so there's nothing to wait for: true when whichever pet reads it is set to that
function petAnalyzeOnly() {
  const s = petState, a = petActive(); if (!a) return false;
  if (s.active && s.pets[s.active] && s.pets[s.active].enabled) return a.mode === 'analyze';
  return PET_KINDS.every(k => !s.pets[k] || !s.pets[k].enabled || s.pets[k].mode === 'analyze');   // auto-pick: any of them might read it
}
async function petAnalyzeAfter(text) {   // the prompt is already sent; the tips show up when they're ready
  petChipPaint(true);
  let r; try { r = await api().pet_prepare(text); } catch (e) { r = null; } finally { petChipPaint(); }
  if (!r || r.skipped) return;
  if (r.error) { toast('Pet', r.error); return; }
  if (r.enhanced || r.missing.length || r.suggestions.length || r.contradictions.length) { api().pet_outcome(r.ids, 'sent-original'); petNote(r, 'tips', text); }
  else if (r.learned.length) petNote(r, 'learned', text);
}
async function petIntercept(text) {
  let r; try { r = await api().pet_prepare(text); } catch (e) { return { text }; }
  if (!r || r.skipped) return { text };
  if (r.error) { toast('Pet', r.error); return { text }; }
  const advice = r.enhanced || r.missing.length || r.suggestions.length || r.contradictions.length;
  if (!advice) return { text, note: r.learned.length ? () => petNote(r, 'learned', text) : null };
  if (r.mode === 'automatic' && r.enhanced) { api().pet_outcome(r.ids, 'auto'); return { text: r.enhanced, note: () => petNote(r, 'improved', text, r.enhanced) }; }
  if (r.mode === 'analyze' || !r.enhanced) { api().pet_outcome(r.ids, 'sent-original'); return { text, note: () => petNote(r, 'tips', text) }; }
  const pick = await petAsk(r, text);
  if (!pick) return null;
  api().pet_outcome(r.ids, pick.action);
  return { text: pick.text, note: pick.action === 'sent-original' ? (r.learned.length ? () => petNote(r, 'learned', text) : null) : () => petNote(r, 'improved', text, pick.text) };
}
// ---- talking with a pet: its own chat. Nothing here is saved; it only remembers what you tell it to (see pets.chat)
const petChats = {};
let petChatBusy = false;
function pcRender(k) {
  const log = $('pcLog'); if (!log || !petState.pets[k]) return;
  const hist = petChats[k] || [];
  log.innerHTML = (hist.length ? hist.map((m, i) => `<div class="pcm ${m.role}"><div class="pcb ${m.err ? 'err' : ''}">${esc(m.text)}</div>${m.prompt ? `<div class="pcprompt"><b>A prompt for your chat</b><div class="pabox">${esc(m.prompt)}</div><button class="btn sm pcuse" data-i="${i}">Use in my chat</button></div>` : ''}</div>`).join('')
    : `<div class="vsub">Say hi to ${esc(petState.pets[k].name)}. Ask what it remembers about you, ask for help with a prompt, or tell it something to remember.</div>`)
    + (petChatBusy ? '<div class="pcm pet"><div class="pcb vsub">…</div></div>' : '');
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('.pcuse').forEach(b => b.onclick = () => { const m = hist[+b.dataset.i]; $('petsDlg').close(); input.value = m.prompt; input.dispatchEvent(new Event('input')); input.focus(); });
}
async function pcSend(k, text) {   // returns the pet's reply text ('' on a problem)
  text = (text || '').trim(); if (!text || petChatBusy || !petState.pets[k]) return '';
  const hist = petChats[k] = petChats[k] || [];
  hist.push({ role: 'user', text }); petChatBusy = true; pcRender(k);
  let r; try { r = await api().pet_chat(k, hist.filter(m => !m.err).map(m => ({ role: m.role, text: m.text }))); } catch (e) { r = { error: 'Something went wrong. Try again.' }; }
  petChatBusy = false;
  if (!r || r.error) hist.push({ role: 'pet', text: (r && r.error) || 'No answer.', err: true });
  else {
    hist.push({ role: 'pet', text: r.text, prompt: r.prompt || '' });
    if (r.remembered) { toast('Pets', petState.pets[k].name + ' will remember that.'); petRefresh(); }
    if (!call.on && $('pcSpeak') && $('pcSpeak').checked) xSpeak(null, r.text, true);
  }
  if (petView.kind === k && petView.tab === 'chat') pcRender(k);
  return r && r.text ? r.text : '';
}
function petsChatPane(k) {
  const pane = $('ppPane'), p = petState.pets[k];
  pane.innerHTML = `<div class="pclog" id="pcLog"></div>
    <div class="pcsug">${['What do you remember about me?', 'Help me write a prompt for ', 'Remember that '].map(t => `<button class="btn sm pcs" data-t="${esc(t)}">${esc(t.trim())}…</button>`).join('')}</div>
    <div class="row"><textarea id="pcIn" rows="2" placeholder="Talk to ${esc(p.name)}…" style="flex:1"></textarea><button class="icon" id="pcMic" hidden title="Speak">🎤</button><button class="icon" id="pcCall" title="Call ${esc(p.name)}: talk and hear the answers">📞</button><button class="primary" id="pcSend">Send</button></div>
    <label class="chk"><input type="checkbox" id="pcSpeak"> <span>Read ${esc(p.name)}'s replies aloud</span></label>
    <div class="vsub">Chats with your pet aren't saved. It only remembers what you tell it ("remember that …") and, with learning on, what it picks up from your prompts. Every reply is one extra AI call.</div>`;
  pcRender(k);
  try { $('pcSpeak').checked = localStorage.getItem('petSpeak') === '1'; } catch (e) {}
  $('pcSpeak').onchange = () => { try { localStorage.setItem('petSpeak', $('pcSpeak').checked ? '1' : '0'); } catch (e) {} };
  const go = async () => { const t = $('pcIn').value; if (!t.trim() || petChatBusy) return; $('pcIn').value = ''; await pcSend(k, t); if ($('pcIn')) $('pcIn').focus(); };
  $('pcSend').onclick = go;
  $('pcIn').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
  pane.querySelectorAll('.pcs').forEach(b => b.onclick = () => { $('pcIn').value = b.dataset.t; $('pcIn').focus(); if (/what do you/i.test(b.dataset.t)) go(); });
  attachMic($('pcMic'), () => $('pcIn'));
  $('pcCall').onclick = () => { $('petsDlg').close(); callStart({ who: p.name, ask: t => pcSend(k, t) }); };
  $('pcIn').focus();
}
// ---- a voice call: you talk, it answers out loud, you talk again. Listening stops while it speaks so it never hears itself.
const callMic = document.createElement('button'), callBox = document.createElement('textarea');
callMic.style.display = callBox.style.display = 'none'; document.body.append(callMic, callBox);
attachMic(callMic, () => callBox);   // the same voice input as the microphone button, into a hidden box
const callListening = () => callMic.classList.contains('mic-rec');
function callPaint(state, text) { const b = $('callBar'); b.className = state; $('callState').textContent = text; $('callWho').textContent = call.who; b.hidden = false; }
function callListen() {
  if (!call.on) return;
  callBox.value = ''; $('callHeard').textContent = ''; callPaint('listen', 'Listening…');
  if (!callListening()) callMic.click();
}
callBox.addEventListener('input', () => {
  if (!call.on) return;
  $('callHeard').textContent = callBox.value;
  clearTimeout(call.timer);
  if (callBox.value.trim()) call.timer = setTimeout(callSubmit, 1700);   // a pause after you stop talking sends it
});
async function callSubmit() {
  if (!call.on) return;
  const text = callBox.value.trim(); clearTimeout(call.timer);
  if (callListening()) callMic.click();
  callBox.value = '';
  if (!text) return callListen();
  if (/^(hang up|end (the |this )?call|goodbye|bye( bye)?|that's all)[.!? ]*$/i.test(text)) return callEnd();
  callPaint('think', 'Thinking…'); $('callHeard').textContent = text;
  let reply = '';
  try { reply = await call.ask(text); } catch (e) { reply = ''; }
  if (!call.on) return;
  let plain = xStripForSpeech(reply);
  if (!plain) { if (!reply) toast('Call', 'No answer came back.'); return callListen(); }
  if (plain.length > 1200) { const cut = plain.slice(0, 1200), at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); plain = (at > 300 ? cut.slice(0, at + 1) : cut) + ' The rest is on screen.'; }
  callPaint('speak', 'Speaking…'); $('callHeard').textContent = '';
  xSpeak(null, plain, true, () => callListen());
}
async function callStart(target) {
  if (call.on) return;
  if ($('micBtn').hidden) { toast('Call', "Voice input isn't available on this PC, so a call can't listen. Check Windows speech settings."); return; }
  call.who = (target && target.who) || 'Auoris';
  call.ask = (target && target.ask) || (text => busy ? Promise.resolve('Auoris is still busy with something else. Say it again in a moment.') : new Promise((resolve, reject) => {
    const w = call.pending = { resolve, reject };
    input.value = text; input.dispatchEvent(new Event('input'));
    Promise.resolve(send()).catch(() => false).then(ok => { if (!ok && call.pending === w) { call.pending = null; reject(new Error('not sent')); } });   // not sent (model still loading...): listen again instead of waiting 5 minutes
    setTimeout(() => { if (call.pending) { call.pending = null; reject(new Error('timeout')); } }, 300000);
  }));
  call.on = true; callListen();
  clearInterval(call.dog);   // the browser's recognizer stops on its own after a quiet spell: start it again while the call is listening
  call.dog = setInterval(() => { if (call.on && $('callBar').className === 'listen' && !callListening() && !callBox.value.trim()) callMic.click(); }, 1500);
}
function callEnd() {
  if (!call.on && $('callBar').hidden) return;
  call.on = false; call.pending = null; clearTimeout(call.timer); clearInterval(call.dog);
  if (callListening()) callMic.click();
  xTtsStop(); $('callBar').hidden = true;
}
$('callEnd').onclick = callEnd;
$('callSkip').onclick = () => { if (!call.on) return; xTtsStop(); callListen(); };
$('callBtn').onclick = () => call.on ? callEnd() : callStart();
window.addEventListener('pywebviewready', async () => { try { if ((SpeechRec) || await api().voice_available()) $('callBtn').hidden = false; } catch (e) {} });
// ---- Multi-AI: one window for /extra, /team, /split and /debate (type the command with no text)
const MULTI_MODES = {
  extra: 'Several models answer your prompt, cross-check each other, and you get one verified final answer.',
  team: 'One model plans and reviews; your selected model does the work with tools, round after round, until the review approves.',
  split: 'A big request is split into parts that different models do at the same time, then merged into one result.',
  debate: 'Two models argue opposite sides of a question and your selected model judges.',
};
let mdMode = 'extra';
function multiMode(m) {
  mdMode = m;
  document.querySelectorAll('#mdTabs button').forEach(b => b.classList.toggle('on', b.dataset.md === m));
  $('mdDesc').textContent = MULTI_MODES[m];
  $('mdPrompt').placeholder = m === 'team' ? 'Example:\nSonnet does planning\nOpus does execution\nFable does review' : 'What should they work on?';
  document.querySelector('#multiDlg .mdextra').hidden = m !== 'extra';
}
async function mdModelsLine() {
  const i = await api().extra_models_info();
  $('mdModels').textContent = 'Joining now: ' + ((i.models || []).filter(x => x !== prefs.model).map(modelLabel).join(', ') || 'only your selected model') + (i.custom ? '' : ' (picked automatically)');
}
async function mdPicksFill() {
  let d = { local: [], cloud: [] }; try { d = await api().models_all(); } catch (e) {}
  const cur = Array.isArray(prefs.extra_models) ? prefs.extra_models : [];
  document.querySelectorAll('.mdpick').forEach((sel, n) => {
    const v = cur[n] || '';
    const opt = (val, l) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`;
    let h = opt('', n === 0 ? 'Auto' : '—');
    if (v && ![...d.local, ...d.cloud.flatMap(g => g.models.map(m => m.value))].includes(v)) h += opt(v, v);   // an older pick by name
    if (d.local.length) h += `<optgroup label="On this PC">${d.local.map(x => opt(x, modelLabel(x))).join('')}</optgroup>`;
    for (const g of d.cloud) if (g.models.length) h += `<optgroup label="${esc(g.name)} (cloud)">${g.models.map(m => opt(m.value, m.name !== m.id ? m.name : m.id)).join('')}</optgroup>`;
    sel.innerHTML = h;
    sel.onchange = async () => {
      prefs.extra_models = [...document.querySelectorAll('.mdpick')].map(x => x.value).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
      await api().set_setting('extra_models', prefs.extra_models);
      document.querySelectorAll('.mdpick')[0].options[0].textContent = prefs.extra_models.length ? '—' : 'Auto';
      mdModelsLine();
    };
  });
  if (cur.length) document.querySelectorAll('.mdpick')[0].options[0].textContent = '—';
  await mdModelsLine();
}
async function multiOpen(mode) {
  multiMode(mode || 'extra');
  $('mdEffort').value = prefs.extra_effort || '';
  $('multiDlg').showModal();
  $('mdPrompt').focus();
  try {
    await mdPicksFill();
  } catch (e) { $('mdModels').textContent = ''; }
}
document.querySelectorAll('#mdTabs button').forEach(b => b.onclick = () => multiMode(b.dataset.md));
$('mdEffort').onchange = async e => { prefs.extra_effort = e.target.value; await api().set_setting('extra_effort', prefs.extra_effort); toast('Auoris Extra effort', e.target.value || 'off'); };
$('mdRun').onclick = async () => {
  const t = $('mdPrompt').value.trim();
  if (!t) { toast('Multi-AI', 'Write what they should work on first.'); return; }
  const r = mdMode === 'extra' ? await api().extra(($('mdPreset').value ? $('mdPreset').value + ' ' : '') + t) : await api().multi(mdMode, t);
  if (r && r.ok === false) return;
  $('mdPrompt').value = '';
  $('multiDlg').close();
  if (r && r.queued) toast('Queued', 'It starts by itself when the current one finishes (see the queue above the message box).');
};
$('mdClose').onclick = () => $('multiDlg').close();
$('multiDlg').onclick = e => { if (outside($('multiDlg'), e)) $('multiDlg').close(); };
// ---- connectors (MCP): servers the user adds; their tools appear for the AI in Code mode (mcp_client.py)
let mcpState = null;
const POLICY = { ask: 'Ask every time', readonly: 'Auto for read-only tools', all: 'Never ask' };
async function mcpOpen() { $('mcpDlg').showModal(); await mcpRefresh(); }
async function mcpRefresh() {
  mcpState = await api().mcp_state();
  const L = mcpState.servers;
  $('mcpList').innerHTML = L.length ? L.map(x => `<div class="mcprow" data-id="${esc(x.id)}">
      <div class="mcphead"><i class="mcpdot ${x.error ? 'bad' : x.connected ? 'ok' : ''}"></i><b>${esc(x.name)}</b><small>${x.transport === 'http' ? esc(x.url) : esc([x.command, ...x.args].join(' ')).slice(0, 80)}</small>
        <label class="chk"><input type="checkbox" class="mcpon" ${x.enabled ? 'checked' : ''}> <span>On</span></label></div>
      <div class="mcpmeta">${x.error ? `<span class="mcperr">${esc(x.error)}</span>` : x.connected ? `${x.tools.length} tool${x.tools.length === 1 ? '' : 's'}: ${esc(x.tools.slice(0, 8).join(', '))}${x.tools.length > 8 ? '…' : ''}` : (x.enabled ? 'Connects when you next use Code mode' : 'Off')}</div>
      <div class="mcpact"><select class="mcppol">${Object.entries(POLICY).map(([k, v]) => `<option value="${k}" ${x.approve === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn mcptest">Test connection</button><button class="dangerbtn mcprm">Remove</button></div></div>`).join('')
    : '<div class="vsub">No connectors yet.</div>';
  $('mcpList').querySelectorAll('.mcprow').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.mcpon').onchange = async e => { await api().mcp_enable(id, e.target.checked); mcpRefresh(); };
    row.querySelector('.mcppol').onchange = async e => {
      if (e.target.value === 'all' && !confirm('With "Never ask" this connector can act without checking with you first - post, edit or delete things in the service it is connected to. Continue?')) { mcpRefresh(); return; }
      await api().mcp_approve(id, e.target.value);
    };
    row.querySelector('.mcptest').onclick = async e => { e.target.textContent = 'Connecting…'; e.target.disabled = true; await api().mcp_test(id); mcpRefresh(); };
    row.querySelector('.mcprm').onclick = async () => { if (confirm('Remove this connector and its saved tokens?')) { await api().mcp_remove(id); mcpRefresh(); } };
  });
  const have = new Set(L.map(x => x.name));
  $('mcpCat').innerHTML = mcpState.catalog.map(k => `<div class="mcpcard"><b>${esc(k.name)}</b><small>${esc(k.desc)}</small><button class="btn" data-k="${k.id}" ${have.has(k.name) ? 'disabled' : ''}>${have.has(k.name) ? 'Added' : 'Add'}</button></div>`).join('');
  $('mcpCat').querySelectorAll('button[data-k]').forEach(b => b.onclick = () => mcpCatalogAdd(mcpState.catalog.find(k => k.id === b.dataset.k), b));
}
let mcpAdding = false;   // one add at a time: a second click while a program starts (npx can take half a minute) made a duplicate
function mcpCatalogAdd(k, btn) {
  const box = $('mcpAsk'); box.innerHTML = '';
  const need = k.ask_args || k.ask_secret;
  const go = async () => {
    if (mcpAdding) return;
    mcpAdding = true; if (btn) btn.disabled = true;
    try { await add(); } finally { mcpAdding = false; if (btn && btn.isConnected) btn.disabled = false; }
  };
  const add = async () => {
    const spec = { name: k.name, transport: k.transport, approve: 'ask', enabled: true };
    let env = null, headers = null;
    if (k.transport === 'stdio') {
      spec.command = k.command; spec.args = [...k.args];
      if (k.ask_args) { const v = ($('mcpAskVal').value || '').trim(); if (!v) { toast('Connector', 'Fill that in first.'); return; } spec.args.push(v); }
    } else {
      spec.url = k.url;
      if (k.ask_secret) { const v = ($('mcpAskVal').value || '').trim(); if (!v) { toast('Connector', 'Fill that in first.'); return; } headers = { [k.ask_secret.header]: k.ask_secret.prefix + v }; }
    }
    if (k.transport === 'stdio' && !confirm(`"${k.name}" is a program that will run on this PC with your account's rights (${k.command} ${spec.args.join(' ')}). Add it?`)) return;
    $('mcpStatus').textContent = 'Connecting…';
    const r = await api().mcp_save(spec, env, headers);
    if (!r.ok) { $('mcpStatus').textContent = r.error; return; }
    box.innerHTML = '';
    const t = await api().mcp_test(r.id);
    $('mcpStatus').textContent = t.ok ? `Connected: ${t.tools.length} tools.` : `Added, but it couldn't connect: ${t.error}`;
    mcpRefresh();
  };
  if (!need) { go(); return; }
  const q = k.ask_args || k.ask_secret;
  box.innerHTML = `<div class="mcpask"><label>${esc(q.label)}</label><div class="row"><input id="mcpAskVal" ${k.ask_secret ? 'type="password" autocomplete="off"' : ''} placeholder="${esc(q.placeholder || '')}">${q.kind === 'folder' ? '<button class="btn" id="mcpAskPick">Browse…</button>' : ''}<button class="primary" id="mcpAskGo">Add and connect</button></div>${q.help ? `<div class="vsub">${esc(q.help)}</div>` : ''}</div>`;
  if (q.kind === 'folder') $('mcpAskPick').onclick = async () => { const p = await api().pick_folder_path(); if (p) $('mcpAskVal').value = p; };
  $('mcpAskGo').onclick = go;
  $('mcpAskVal').focus();
}
$('mcpType').onchange = () => { const h = $('mcpType').value === 'http'; $('mcpCmd').hidden = $('mcpArgs').hidden = h; $('mcpUrl').hidden = !h; };
$('mcpAdd').onclick = async () => {
  if (mcpAdding) return;
  mcpAdding = true; $('mcpAdd').disabled = true;
  try { await mcpAddOwn(); } finally { mcpAdding = false; $('mcpAdd').disabled = false; }
};
async function mcpAddOwn() {
  const http = $('mcpType').value === 'http', secrets = {};
  for (const line of $('mcpSecrets').value.split('\n')) { const i = line.indexOf('='); if (i > 0) secrets[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const spec = { name: $('mcpName').value, transport: $('mcpType').value, approve: $('mcpPolicy').value, enabled: true };
  if (http) spec.url = $('mcpUrl').value; else { spec.command = $('mcpCmd').value; spec.args = $('mcpArgs').value.split('\n').map(x => x.trim()).filter(Boolean); }
  if (!http && !confirm(`This program will run on your PC with your account's rights:\n\n${spec.command} ${spec.args.join(' ')}\n\nOnly continue if you trust it.`)) return;
  if (spec.approve === 'all' && !confirm('"Never ask" lets this connector act without checking with you first. Continue?')) return;
  const r = await api().mcp_save(spec, http ? null : secrets, http ? secrets : null);
  if (!r.ok) { $('mcpStatus').textContent = r.error; return; }
  ['mcpName', 'mcpCmd', 'mcpArgs', 'mcpUrl', 'mcpSecrets'].forEach(i => $(i).value = '');
  $('mcpStatus').textContent = 'Connecting…';
  const t = await api().mcp_test(r.id);
  $('mcpStatus').textContent = t.ok ? `Connected: ${t.tools.length} tools.` : `Added, but it couldn't connect: ${t.error}`;
  mcpRefresh();
}
$('mcpClose').onclick = () => $('mcpDlg').close();
const prettyTool = n => /^mcp__/.test(n) ? n.split('__').slice(2).join(' ').replace(/_/g, ' ') : n;
// ---- /benchmark: up to 5 models, same graded questions, % correct per category
let bnData = null, bnInfo = null, bnRunning = false;
async function benchOpen() {
  $('benchDlg').showModal();
  if (bnRunning) return;
  $('bnStatus').textContent = 'Loading models…';
  try { bnInfo = await api().benchmark_info(); bnData = await api().models_all(); } catch (e) { $('bnStatus').textContent = 'Couldn\'t list models.'; return; }
  $('bnStatus').textContent = '';
  let saved = []; try { saved = JSON.parse(localStorage.getItem('bnModels') || '[]'); } catch (e) {}
  if (!saved.length) saved = [prefs.model || ''];
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  let html = '<option value="">(none)</option>';
  if (bnData.local.length) html += `<optgroup label="On this PC">${bnData.local.map(n => opt(n, modelLabel(n))).join('')}</optgroup>`;
  for (const g of bnData.cloud) if (g.models.length) html += `<optgroup label="${esc(g.name)} (cloud)">${g.models.map(m => opt(m.value, m.name !== m.id ? m.name : m.id)).join('')}</optgroup>`;
  $('bnSel').innerHTML = Array.from({ length: bnInfo.max }, (_, i) => `<select id="bn${i}">${html}</select>`).join('');
  saved.forEach((v, i) => { const el = $('bn' + i); if (el && [...el.options].some(o => o.value === v)) el.value = v; });
  let cs = null; try { cs = JSON.parse(localStorage.getItem('bnCats') || 'null'); } catch (e) {}
  $('bnCats').innerHTML = bnInfo.categories.map(c => `<label class="chk"><input type="checkbox" data-c="${c.id}" ${!cs || cs.includes(c.id) ? 'checked' : ''}> <span>${esc(c.name)} <small>${c.n} questions</small></span></label>`).join('');
}
$('bnRun').onclick = async () => {
  const models = [...new Set([...document.querySelectorAll('#bnSel select')].map(e => e.value).filter(Boolean))];
  const cats = [...document.querySelectorAll('#bnCats input:checked')].map(e => e.dataset.c);
  if (!models.length || !cats.length) { toast('Benchmark', 'Pick at least one model and one category.'); return; }
  try { localStorage.setItem('bnModels', JSON.stringify([...document.querySelectorAll('#bnSel select')].map(e => e.value))); localStorage.setItem('bnCats', JSON.stringify(cats)); } catch (e) {}
  const r = await api().benchmark_start(models, cats);
  if (!r.ok) { toast('Benchmark', r.error); return; }
  bnRunning = true; $('bnRun').hidden = true; $('bnStop').hidden = false; benchmarkUpdate(r.snapshot);
};
$('bnStop').onclick = () => api().benchmark_stop();
$('bnOut').onclick = e => { const b = e.target.closest('.bnstop'); if (b) { b.disabled = true; api().benchmark_stop_model(b.dataset.m); } };
$('bnClose').onclick = () => $('benchDlg').close();
function benchmarkUpdate(s) {  // called from Python as answers arrive
  if (!s) return;
  const missOpen = !!$('bnOut').querySelector('.bnmiss[open]');   // the table is redrawn on every answer: keep "Wrong answers" open if it was
  const names = s.categories, cids = Object.keys(names), done = m => Object.keys(s.results[m] || {}).length;
  const best = Math.max(...s.models.map(m => s.scores[m].pct));
  const col = pct => `hsl(${Math.round(pct * 1.2)} 55% 45%)`;
  $('bnOut').innerHTML = `<div class="bnwrap"><table class="bntab"><thead><tr><th></th>${s.models.map(m => `<th title="${esc(m)}">${esc(modelLabel(m))}${s.stopped_models && s.stopped_models.includes(m) ? ' <small>(stopped)</small>' : (!s.done && done(m) < s.total ? ` <button class="bnstop" data-m="${esc(m)}" title="Stop just this model">■</button>` : '')}</th>`).join('')}</tr></thead><tbody>
    <tr class="bnall"><td>Overall</td>${s.models.map(m => { const x = s.scores[m], dn = done(m); return `<td class="${dn && x.pct === best && s.models.length > 1 && dn === s.total ? 'bnbest' : ''}"><b style="color:${col(x.pct)}">${dn ? x.pct + '%' : '–'}</b><small>${x.ok}/${s.total} correct · ${dn}/${s.total} asked${x.secs ? ' · ' + x.secs + 's each' : ''}</small><i style="width:${x.pct}%;background:${col(x.pct)}"></i></td>`; }).join('')}</tr>
    ${cids.map(c => `<tr><td>${esc(names[c])}</td>${s.models.map(m => { const k = s.scores[m].cats[c], p = k.of ? Math.round(100 * k.ok / k.of) : 0; return `<td>${k.done ? `<b style="color:${col(p)}">${p}%</b><small>${k.ok}/${k.of}</small>` : '<small>–</small>'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>` + s.models.filter(m => s.errors[m]).map(m => `<div class="bnerr"><b>${esc(modelLabel(m))}</b>: ${esc(s.errors[m])}</div>`).join('') +
    `<details class="bnmiss" ${missOpen ? 'open' : ''}><summary>Wrong answers <small>(hover a code to see the question)</small></summary>${s.models.map(m => { const w = Object.entries(s.results[m] || {}).filter(([, r]) => !r.ok && !r.error); return w.length ? `<div><b>${esc(modelLabel(m))}</b>: ${w.map(([q, r]) => { const i = (s.qinfo || {})[q] || {}; return `<span title="${esc(i.t || '')} (expected: ${esc(i.e || '')})">${esc(q)}</span> → ${esc(r.answer || '(empty)')}`; }).join(' · ')}</div>` : ''; }).join('') || '<div class="vsub">None yet.</div>'}</details>`;
  const total = s.models.reduce((n, m) => n + done(m), 0), all = s.models.length * s.total;
  $('bnStatus').textContent = (s.done ? (s.stopped ? 'Stopped' : 'Done') + ` in ${s.secs}s` : `${total}/${all} answers…`) + (s.seed ? ` · new questions every run (set ${s.seed})` : '');
  if (s.done) { bnRunning = false; $('bnRun').hidden = false; $('bnStop').hidden = true; }
}
// ---- compare models
let xCmp = null, xCmpTick = null, xCmpData = null;
function xCmpFill(sel) {
  const d = xCmpData, want = [0, 1, 2].map(i => $('xCmp' + i).value);
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  let html = '<option value="">(none)</option>';
  if (d.local.length) html += `<optgroup label="On this PC">${d.local.map(n => opt(n, modelLabel(n))).join('')}</optgroup>`;
  for (const g of d.cloud) if (g.models.length) html += `<optgroup label="${esc(g.name)} (cloud)">${g.models.map(m => opt(m.value, m.name !== m.id ? m.name : m.id)).join('')}</optgroup>`;
  [0, 1, 2].forEach(i => {
    const el = $('xCmp' + i); el.innerHTML = html;
    const v = sel[i] || want[i]; el.value = [...el.options].some(o => o.value === v) ? v : '';
  });
}
async function xCompareOpen(prompt) {
  if (prompt) $('xCmpPrompt').value = prompt;
  $('xCompareDlg').showModal();
  if (xCmp) return;  // a run is on screen: leave it alone
  let saved = []; try { saved = JSON.parse(localStorage.getItem('xcmp') || '[]'); } catch (e) {}
  if (!saved.length) saved = [prefs.model || ''];
  $('xCmpStatus').textContent = 'Loading models…';
  try { xCmpData = await api().models_all(); } catch (e) { $('xCmpStatus').textContent = 'Couldn\'t list models.'; return; }
  $('xCmpStatus').textContent = '';
  xCmpFill(saved);
  if (!$('xCmp1').value) { const o = [...$('xCmp1').options].find(x => x.value && x.value !== $('xCmp0').value); if (o) $('xCmp1').value = o.value; }
}
function xCmpButtons(running) { $('xCmpRun').hidden = running; $('xCmpStop').hidden = !running; }
$('xCmpRun').onclick = async () => {
  const models = [...new Set([0, 1, 2].map(i => $('xCmp' + i).value).filter(Boolean))], prompt = $('xCmpPrompt').value.trim();
  if (!prompt) { toast('Compare', 'Type a prompt first.'); return; }
  if (models.length < 2) { toast('Compare', 'Pick at least 2 different models.'); return; }
  try { localStorage.setItem('xcmp', JSON.stringify([0, 1, 2].map(i => $('xCmp' + i).value))); } catch (e) {}
  const r = await api().compare_start(prompt, models);
  if (!r.ok) { toast('Compare', r.error); return; }
  xCmp = { id: r.id, models };
  $('xCmpOut').innerHTML = models.map(m => `<div class="xcol" data-state="wait"><div class="xch"><b title="${esc(m)}">${esc(modelLabel(m))}</b><span>waiting…</span></div><div class="xcb"><span class="vsub">Waiting to start…</span></div></div>`).join('');
  xCmpButtons(true); $('xCmpStatus').textContent = '';
  clearInterval(xCmpTick);
  xCmpTick = setInterval(() => document.querySelectorAll('#xCmpOut .xcol[data-state="running"]').forEach(c => {
    c.querySelector('.xch span').textContent = '⏳ ' + ((Date.now() - +c.dataset.t0) / 1000).toFixed(1) + 's';
  }), 300);
};
$('xCmpStop').onclick = () => api().compare_stop();
function compareUpdate(runId, i, text, secs, state, err) {  // called from Python
  if (!xCmp || xCmp.id !== runId) return;
  const col = $('xCmpOut').children[i]; if (!col) return;
  col.dataset.state = state;
  if (state === 'running' && !col.dataset.t0) col.dataset.t0 = Date.now() - secs * 1000;
  if (state !== 'running') col.querySelector('.xch span').textContent = ({ done: '✓ ', stopped: '■ ', error: '✕ ' }[state] || '') + secs + 's';
  col.querySelector('.xcb').innerHTML = (text ? md(text) : (state === 'running' ? '<span class="vsub">…</span>' : '')) +
    (err ? `<div style="color:var(--err);margin-top:6px">${esc(err)}</div>` : '');
}
function compareDone(runId, stopped) {
  if (!xCmp || xCmp.id !== runId) return;
  clearInterval(xCmpTick); xCmp = null; xCmpButtons(false);
  $('xCmpStatus').textContent = stopped ? 'Stopped.' : 'Done.';
}
$('xCmpClose').onclick = () => $('xCompareDlg').close();
$('xCompareDlg').addEventListener('close', () => { if (xCmp) api().compare_stop(); });

// ---- read aloud (Web Speech API, feature-detected)
const XTTS = { sys: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window, ok: true, el: null, gen: 0, audio: null, piper: null };   // ok: the natural voice may be installed even where the system one is missing
function xStripForSpeech(src) {
  return String(src || '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')                       // code blocks are skipped entirely
    .replace(/`([^`\n]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ').replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, ' ').replace(/\|/g, ', ').replace(/(\*\*|__|~~|\*)/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
function xChunks(text) {  // short utterances: long ones get cut off by some engines
  const out = []; let buf = '';
  for (const s of text.split(/(?<=[.!?。])\s+|\n+/)) {
    if (buf && (buf + ' ' + s).length > 220) { out.push(buf); buf = s; } else buf = buf ? buf + ' ' + s : s;
  }
  if (buf) out.push(buf);
  return out.filter(x => x.trim());
}
function xTtsIdle() { XTTS.el = null; document.querySelectorAll('.xspeak.on').forEach(b => { b.classList.remove('on'); b.textContent = '🔊'; b.title = 'Read this reply aloud'; }); $('ttsStop').hidden = true; }
function xTtsStop() { XTTS.gen++; try { speechSynthesis.cancel(); } catch (e) {} if (XTTS.audio) { try { XTTS.audio.pause(); } catch (e) {} XTTS.audio = null; } xTtsIdle(); }
async function xPiperRefresh() { try { XTTS.piper = await api().tts_status(); } catch (e) { XTTS.piper = null; } return XTTS.piper; }
const xPiperReady = vid => !!(XTTS.piper && XTTS.piper.voices && XTTS.piper.voices[vid || 'us-natural']);
async function xSpeakPiper(parts, gen, vid, rate, onEnd) {   // each sentence is made on this PC while the previous one plays
  const make = p => api().tts_speak(p, vid, rate);
  let next = make(parts[0]);
  for (let i = 0; i < parts.length; i++) {
    const r = await next; if (gen !== XTTS.gen) return;
    if (i + 1 < parts.length) next = make(parts[i + 1]);
    if (!r || r.error) { toast('Read aloud', (r && r.error) || 'The natural voice failed.'); break; }
    await new Promise(res => { const au = new Audio(r.audio); XTTS.audio = au; au.onended = au.onerror = res; au.play().catch(res); });
    if (gen !== XTTS.gen) return;
  }
  if (gen === XTTS.gen) { xTtsIdle(); if (onEnd) onEnd(); }
}
function xSpeak(el, text, quiet, onEnd, opts) {   // opts (the Settings test) overrides the saved choices
  const o = Object.assign({ engine: prefs.tts_engine, piperVoice: prefs.tts_piper_voice, voice: prefs.tts_voice, rate: prefs.tts_rate }, opts || {});
  const piper = o.engine === 'piper' && xPiperReady(o.piperVoice);
  if (!piper && !XTTS.sys) { if (!quiet) toast('Read aloud', o.engine === 'piper' ? "The natural voice isn't installed yet (Settings, Read replies aloud)." : 'This PC has no built-in voice.'); if (onEnd) onEnd(); return; }
  const plain = xStripForSpeech(text);
  if (!plain) { if (!quiet) toast('Read aloud', 'Nothing to read in that reply (code blocks are skipped).'); if (onEnd) onEnd(); return; }
  xTtsStop();
  const gen = ++XTTS.gen, parts = xChunks(plain), rate = Math.min(2, Math.max(0.5, +o.rate || 1));
  if (piper) xSpeakPiper(parts, gen, o.piperVoice || 'us-natural', rate, onEnd);
  else {
    const v = speechSynthesis.getVoices().find(x => x.voiceURI === o.voice);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = rate;
      u.onend = u.onerror = () => { if (gen === XTTS.gen && i === parts.length - 1) { xTtsIdle(); if (onEnd) onEnd(); } };
      speechSynthesis.speak(u);
    });
  }
  XTTS.el = el; $('ttsStop').hidden = false;
  const b = el && el.querySelector('.xspeak'); if (b) { b.classList.add('on'); b.textContent = '■'; b.title = 'Stop reading'; }
}
function xAddSpeak(el, text) {
  if (!XTTS.ok || !el) return;
  el._xraw = text || '';
  if (!xStripForSpeech(el._xraw) || el.querySelector('.xspeak')) return;
  let m = el.querySelector('.meta'); if (!m) { m = document.createElement('div'); m.className = 'meta'; el.appendChild(m); }
  const b = document.createElement('button'); b.className = 'xspeak'; b.textContent = '🔊'; b.title = 'Read this reply aloud';
  b.onclick = () => XTTS.el === el ? xTtsStop() : xSpeak(el, el._xraw);
  m.appendChild(b);
}
$('ttsStop').onclick = xTtsStop;
function xFillVoices() {
  if (!XTTS.sys) return;
  const vs = speechSynthesis.getVoices(), sel = $('ttsVoiceIn'), cur = sel.value || prefs.tts_voice || '';
  sel.innerHTML = '<option value="">System default</option>' + vs.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
}
function xPiperPaint() {
  const p = XTTS.piper, sel = $('ttsPiperVoiceIn'), box = $('ttsPiperBox');
  if (!p) { $('ttsPiperStatus').textContent = ''; return; }
  const cur = sel.value || prefs.tts_piper_voice || 'us-natural';
  sel.innerHTML = p.catalog.map(v => `<option value="${v.id}">${esc(v.label)}${p.voices[v.id] ? ' (installed)' : ' (' + v.mb + ' MB download)'}</option>`).join('');
  sel.value = p.catalog.some(v => v.id === cur) ? cur : 'us-natural';
  const on = $('ttsEngineIn').value === 'piper', have = !!p.voices[sel.value];
  box.hidden = !on;
  $('ttsPiperInstall').hidden = !on || have || p.installing; $('ttsPiperRemove').hidden = !on || !p.engine;
  if (!p.installing) $('ttsPiperStatus').textContent = !on ? '' : have ? 'Installed. Speech is made on this PC and nothing is sent anywhere.' : 'Free and offline. One-time download from GitHub and Hugging Face; nothing you read aloud ever leaves this PC.';
}
function ttsProgress(f) { $('ttsPiperStatus').textContent = 'Downloading the natural voice… ' + Math.round(f * 100) + '%'; $('ttsPiperInstall').hidden = true; }
async function ttsInstalled(ok, msg, voice) {
  await xPiperRefresh();
  if (ok) {
    prefs.tts_engine = 'piper'; prefs.tts_piper_voice = voice;
    api().set_setting('tts_engine', 'piper'); api().set_setting('tts_piper_voice', voice);
    $('ttsEngineIn').value = 'piper'; toast('Natural voice', 'Installed. Replies will now be read with it.');
  } else toast('Natural voice', msg || 'The download failed.');
  xPiperPaint();
}
async function xSettingsOpen() {
  $('xTtsSet').hidden = !XTTS.ok;
  if (!XTTS.ok) return;
  $('ttsEngineIn').value = prefs.tts_engine === 'piper' ? 'piper' : 'system';
  await xPiperRefresh(); xPiperPaint();
  $('ttsAutoIn').checked = !!prefs.tts_auto; $('ttsRateIn').value = prefs.tts_rate || 1; $('ttsRateLbl').textContent = '(' + (+$('ttsRateIn').value).toFixed(1) + 'x)';
  $('ttsVoiceIn').value = prefs.tts_voice || ''; xFillVoices();
}
if (XTTS.ok) {
  if (XTTS.sys && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', xFillVoices);
  window.addEventListener('pywebviewready', () => xPiperRefresh());
  $('ttsRateIn').oninput = () => { $('ttsRateLbl').textContent = '(' + (+$('ttsRateIn').value).toFixed(1) + 'x)'; };
  $('ttsTestBtn').onclick = () => {  // audition with the unsaved picks
    xSpeak(null, 'This is how replies will sound.', false, null, { engine: $('ttsEngineIn').value, piperVoice: $('ttsPiperVoiceIn').value, voice: $('ttsVoiceIn').value, rate: +$('ttsRateIn').value || 1 });
  };
  $('ttsEngineIn').onchange = xPiperPaint; $('ttsPiperVoiceIn').onchange = xPiperPaint;
  $('ttsPiperInstall').onclick = async () => { const r = await api().tts_install($('ttsPiperVoiceIn').value); if (r && r.ok) { $('ttsPiperInstall').hidden = true; $('ttsPiperStatus').textContent = 'Starting the download…'; } else toast('Natural voice', (r && r.error) || "Couldn't start."); };
  $('ttsPiperRemove').onclick = async () => { if (!await ask({ title: 'Remove the natural voice?', html: 'This deletes the downloaded voice from this PC. You can download it again later.', ok: 'Remove' })) return; if (!await api().tts_remove()) { toast('Natural voice', 'A voice is still downloading. Remove it when the download has finished.'); return; } if (prefs.tts_engine === 'piper') { prefs.tts_engine = 'system'; api().set_setting('tts_engine', 'system'); $('ttsEngineIn').value = 'system'; } await xPiperRefresh(); xPiperPaint(); };
}

// ---- chat with a folder
async function xFolderOpen() {
  await xRefreshExt(); xFolderPaint(); $('xFolderDlg').showModal();
}
function xFolderPaint() {
  const f = xExt.folder;
  $('xFoInfo').innerHTML = f ? `<b>${esc(f.root)}</b><br>${f.files} files · ${f.chunks} passages indexed` + (f.skipped ? ` · ${f.skipped} skipped (binary, large or secret-looking)` : '') +
    (f.truncated ? ' · <b>limit reached</b>: some files were not indexed' : '') + (f.built ? ` · indexed ${esc(new Date(f.built * 1000).toLocaleString())}` : '') +
    '<br>Only this chat uses it. Turn it off any time.' : 'No folder selected for this chat.';
  $('xFoRe').disabled = $('xFoOff').disabled = !f;
}
async function xFolderAttach(path) {
  $('xFoInfo').textContent = 'Indexing… (first time can take a few seconds)'; $('xFoPick').disabled = $('xFoRe').disabled = true;
  const r = await api().folder_attach(path || null);
  $('xFoPick').disabled = false;
  if (r.error) toast('Folder', r.error); else if (!r.cancelled) { xExt = r; xPaintExt(); toast('Folder', `${r.folder.files} files indexed. Matching passages will be added to your messages in this chat.`); }
  xFolderPaint();
}
$('xFoPick').onclick = () => xFolderAttach();
$('xFoRe').onclick = () => xExt.folder && xFolderAttach(xExt.folder.root);
$('xFoOff').onclick = async () => { xExt = await api().folder_detach(); xPaintExt(); xFolderPaint(); toast('Folder', 'Off for this chat'); };
$('xFoClose').onclick = () => $('xFolderDlg').close();
$('xFolderDlg').onclick = e => { if (outside($('xFolderDlg'), e)) $('xFolderDlg').close(); };

// ---- export
let xExCid = null;
function xExportDlg(cid) { xExCid = cid || null; $('xExportDlg').showModal(); }
$('xExClose').onclick = () => $('xExportDlg').close();
$('xExportDlg').onclick = e => { if (outside($('xExportDlg'), e)) $('xExportDlg').close(); };
$('xExportDlg').querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
  const [scope, fmt] = b.dataset.x.split('|');
  $('xExportDlg').close();
  const r = scope === 'all' ? await api().export_all(fmt) : await api().export_chat(xExCid || chatId, fmt);
  if (r.cancelled) return;
  if (r.error) toast('Export', r.error); else toast('Exported', `${r.count} chat${r.count === 1 ? '' : 's'} saved to ${r.path}`);
});

// ---- import chats (see importers.py). Titles are set with textContent, never innerHTML.
let xImPath = '', xImTotal = 0, xImShown = 0;
function xImportDlg() {
  $('xImBody').hidden = true; $('xImMsg').textContent = ''; $('xImFile').textContent = ''; xImPath = '';
  $('xImportDlg').showModal();
}
function xImSetBusy(b) { ['xImPick', 'xImGo', 'xImAll', 'xImNone'].forEach(i => $(i).disabled = b); }
$('xImClose').onclick = () => $('xImportDlg').close();
$('xImportDlg').onclick = e => { if (outside($('xImportDlg'), e)) $('xImportDlg').close(); };
$('xImPick').onclick = async () => {
  const f = await api().import_chats_pick();
  if (f.cancelled) return;
  xImPath = f.path; $('xImFile').textContent = f.name; $('xImBody').hidden = true; $('xImMsg').textContent = 'Reading…';
  xImSetBusy(true);
  const r = await api().import_chats_preview(xImPath);
  xImSetBusy(false);
  if (r.error) { $('xImMsg').textContent = r.error; return; }
  xImTotal = r.count; xImShown = r.titles.length;
  $('xImMsg').textContent = r.truncated || '';
  $('xImInfo').textContent = `Detected: ${r.source_name}. ${r.count} chat${r.count === 1 ? '' : 's'}, ${r.messages} messages` + (r.bad ? `; ${r.bad} unreadable or empty will be skipped` : '') + '.' + (r.count > xImShown ? ` Showing the first ${xImShown}; chats beyond those are imported when they are selected with "Select all".` : '');
  const list = $('xImList'); list.textContent = '';
  r.titles.forEach(t => {
    const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true; c.dataset.i = t.i;
    const sp = document.createElement('span'); sp.textContent = `${t.title} (${t.n})`;
    l.append(c, sp); list.appendChild(l);
  });
  $('xImProg').textContent = ''; $('xImBody').hidden = false;
};
$('xImAll').onclick = () => $('xImList').querySelectorAll('input').forEach(c => c.checked = true);
$('xImNone').onclick = () => $('xImList').querySelectorAll('input').forEach(c => c.checked = false);
$('xImGo').onclick = async () => {
  const boxes = [...$('xImList').querySelectorAll('input')], on = boxes.filter(c => c.checked).map(c => +c.dataset.i);
  const all = on.length === boxes.length;  // everything shown ticked: import the chats beyond the list too
  if (!on.length) { $('xImMsg').textContent = 'Tick at least one chat.'; return; }
  xImSetBusy(true); $('xImMsg').textContent = ''; $('xImProg').textContent = 'Importing…';
  const r = await api().import_chats_run(xImPath, all ? 'all' : on);
  if (r.error) { xImSetBusy(false); $('xImProg').textContent = ''; $('xImMsg').textContent = r.error; }
};
function importProgress(d, t) { $('xImProg').textContent = `Importing ${d} / ${t}…`; }
function importDone(s) {
  xImSetBusy(false); $('xImProg').textContent = '';
  if (s.error) { $('xImMsg').textContent = s.error; return; }
  $('xImBody').hidden = true;
  $('xImMsg').textContent = `Done: ${s.imported} imported, ${s.duplicates} skipped as already imported, ${s.bad} skipped as unreadable.` + (s.truncated ? ' ' + s.truncated : '');
  refreshChats();
}
COMMANDS.push({ cmd: '/importfile', desc: 'Import chats from an export file (ChatGPT, Claude, JSON or Markdown)', run: () => xImportDlg() });   // /import (above) scans this PC

// ---- slash commands
COMMANDS.push(
  { cmd: '/prompts', desc: 'Prompt library: insert a saved prompt', run: () => xPromptsOpen() },
  { cmd: '/persona', desc: 'Pick a persona for this chat', arg: 'name | none | manage', get opts() { return ['none', 'manage', ...xPersonaNames]; },
    run: async a => {
      a = (a || '').trim().toLowerCase(); if (!a) return xPersonaMenu();
      if (a === 'manage') { openSettings('personas'); return xPerDraw(); }
      if (a === 'none' || a === 'off') return xSetPersona('');
      const p = (await api().personas_list()).find(x => x.name.toLowerCase() === a);
      if (p) xSetPersona(p.id); else toast('Persona', `No persona named "${a}". Add one in Settings → Personas.`);
    } },
  { cmd: '/call', desc: 'Call Auoris: talk instead of typing and hear the answers out loud (say "hang up" to end)', run: () => callStart() },
  { cmd: '/pets', desc: 'Auoris Pets: up to four companions (dog, cat, parrot, fish) that improve your prompts and learn only what you allow', run: () => petsOpen() },
  { cmd: '/mcp', desc: 'Connectors (MCP): give the AI tools like GitHub, a browser or extra folders', run: () => mcpOpen() },
  { cmd: '/benchmark', desc: 'Test up to 5 models side by side on graded questions (math, reasoning, knowledge, coding, instructions) and see the % each gets right', run: () => benchOpen() },
  { cmd: '/compare', desc: 'Send one prompt to 2-3 models and compare', arg: 'prompt', run: a => xCompareOpen((a || '').trim()) },
  { cmd: '/folder', desc: 'Chat with a folder (keyword search)', arg: 'off (optional)',
    run: async a => { if ((a || '').trim().toLowerCase() === 'off') { xExt = await api().folder_detach(); xPaintExt(); toast('Folder', 'Off for this chat'); } else xFolderOpen(); } },
  { cmd: '/export', desc: 'Export this chat or all chats (Markdown / HTML)', run: () => xExportDlg() },
);
window.addEventListener('pywebviewready', () => { xRefreshExt(); api().personas_list().then(l => { xPersonaNames = l.map(p => p.name.toLowerCase()); }).catch(() => {}); });

window.addEventListener('pywebviewready', async () => {
  try { if (localStorage.getItem('noside')) document.body.classList.add('noside'); } catch (e) {}
  const s = await api().init();
  prefs = s;
  appMode(s.app_mode);
  chatId = s.chat_id;
  loadPlugins();
  setCwd(s.cwd); setPerm(s.permission_mode || 'ask');
  $('effortSel').value = s.effort || 'medium'; effortFor = ''; effortMenu();
  $('thinkBtn').classList.toggle('on', !!s.deep_think);
  $('fastBtn').classList.toggle('on', !!s.fast_mode); $('effortSel').disabled = $('thinkBtn').disabled = !!s.fast_mode;
  maskNames = s.usernames || []; setMask(!!s.hide_username);
  setModeUI(s.mode); setIncognitoUI(s.incognito);
  try { const pm = await api().profile_media(); if (pm) Object.assign(media, pm); } catch (e) {}
  applyPrefs();
  try { legalCheck(); } catch (e) {}
  try { if (MIND_APP) tourMaybeStart(); } catch (e) {}   // the tour shows the AI
  if (s.ready) setStatus('Ready', 'ready');
  showEmpty();
  await refreshChats();
  if (s.resume_chat) openChat(s.resume_chat);
  if (s.updated) setTimeout(() => toast(`✨ Updated to Auoris ${s.updated.to}`, (s.updated.notes || 'Enjoy the new version!').replace(/[#*`]/g, '').slice(0, 300)), 1200);
  if (MIND_APP) homeStart(s); else showView('minecraft');
  input.focus();
  setTimeout(() => document.body.classList.remove('intro'), 1800);  // intro plays once
});
