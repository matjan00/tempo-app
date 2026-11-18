// Settings sheet: appearance, sync, data backup, help, about.
import * as store from './store.js';
import * as theme from './theme.js';
import { openSheet, sheetHeader, closeBtn, confirmDialog, toast, focusSnapshot, focusRestore } from './ui.js';
import { esc, ymd } from './util.js';
import { icon } from './icons.js';
import { VERSION } from './version.js';
import * as push from './push.js';
import * as sync from './sync.js';
import { install as runInstall, isStandalone, onInstallChange } from './install.js';

let current = null; // open sheet record

onInstallChange(() => current && !current.closed && draw());
addEventListener('sync-status', () => current && !current.closed && draw());

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString();
};

function syncSection() {
  if (!sync.configured()) return '';
  const st = sync.status();
  if (!st.connected)
    return `<h3 class="set-h">Sync</h3>
    <div class="set-card">
      <p class="set-hint">Keeps a copy of your tasks, habits and day plans on your own server, so Claude can plan your day. Paste the sync key printed by setup-sync.</p>
      <input class="field set-key" data-synckey type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx" aria-label="Sync key">
      <button class="btn primary set-btn" data-act="sync-connect">Connect</button>
    </div>`;
  const waiting = st.pending ? ` · ${st.pending} waiting` : '';
  const line =
    st.err === 'key' ? 'key refused. disconnect and enter it again.'
    : st.err === 'offline' ? `offline${waiting}`
    : st.err ? `last sync failed, retrying${waiting}`
    : st.busy ? 'syncing…'
    : st.last ? `synced ${ago(st.last)}${waiting}`
    : 'not synced yet';
  return `<h3 class="set-h">Sync</h3>
    <div class="set-card">
      <div class="set-row"><span>Status</span><span class="set-ver" aria-live="polite">${esc(line)}</span></div>
      <div class="set-btns"><button class="btn ghost set-btn" data-act="sync-now">Sync now</button><button class="btn ghost set-btn" data-act="sync-off">Disconnect</button></div>
    </div>
    ${push.supported() ? `<div class="set-card"><div class="set-row set-tog"><label><span>Ask “done?” when a block ends</span><span class="switch"><input type="checkbox" data-tog="blockAlarms" ${store.get().settings.blockAlarms ? 'checked' : ''}><i></i><b class="sw-t" aria-hidden="true"></b></span></label><p class="set-hint">When a task, habit or personal block in today’s plan ends you get a notification with Done and Missed buttons, even when to-do is closed. Block starts come from the Plan calendar.</p></div></div>` : ''}`;
}

const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];


function html() {
  const s = store.get().settings;
  const seg = THEMES.map(([v, l]) => `<button data-theme="${v}" class="${s.theme === v ? 'on' : ''}" aria-pressed="${s.theme === v}">${l}</button>`).join('');
  const sw = Object.entries(theme.ACCENTS)
    .map(([id, a]) => {
      const bg = a.c || 'conic-gradient(#1c1c1e 50%, #f2f2f3 0)';
      return `<button class="set-sw ${s.accent === id ? 'on' : ''}" data-accent="${id}" style="background:${bg}" aria-label="accent ${esc(a.name.toLowerCase())}" aria-pressed="${s.accent === id}" title="${esc(a.name.toLowerCase())}"></button>`;
    })
    .join('');
  // plain-language help: the quick-add words and the hidden gestures
  const helpRow = (k, v) => `<div class="help-row"><dt>${k}</dt><dd>${v}</dd></div>`;
  const help = `<h4 class="help-h">quick add: type these in the bar</h4>
    <dl class="help">
      ${helpRow('tomorrow, fri, next week, in 3 days', 'sets the date')}
      ${helpRow('!1 · !2 · !3', '!1 high · !2 medium · !3 low priority')}
      ${helpRow('#gym', 'adds a tag')}
      ${helpRow('@work', 'marks it as work (default is personal)')}
      ${helpRow('*2', 'makes it 2 × 25 min long')}
      ${helpRow('30m · 1h · 1h30', 'how long it takes (used by the day plan)')}
      ${helpRow('every week', 'makes it repeat')}
      ${helpRow('every day', 'makes it a daily habit')}
    </dl>
    <p class="set-hint">tap a word in the preview above the bar to keep it as plain text.</p>
    <h4 class="help-h">gestures</h4>
    <dl class="help">
      ${helpRow('press and hold a task', 'quick actions: move the date, work or personal, delete')}
      ${helpRow('swipe a sheet down', 'closes it (so does the back gesture)')}
      ${helpRow('Shift+F10 on a task', 'quick actions from the keyboard')}
    </dl>`;
  const install = isStandalone() ? '' : `<button class="btn primary set-btn" data-act="install">Install app</button>`;
  return `${sheetHeader('Settings', closeBtn())}
  <div class="set-body">
    <h3 class="set-h">Appearance</h3>
    <div class="set-card"><div class="set-seg">${seg}</div><div class="set-swatches">${sw}</div></div>
    ${syncSection()}
    <h3 class="set-h">Data</h3>
    <div class="set-card">
      <p class="set-hint">${sync.connected() ? 'Stored on this phone and synced to your own server.' : 'Everything is stored only on this phone.'} Export a backup now and then.</p>
      <div class="set-btns"><button class="btn ghost set-btn" data-act="export">Export backup</button><button class="btn ghost set-btn" data-act="import">Import backup</button></div>
      <input type="file" accept="application/json,.json" hidden data-file>
      <div class="set-danger">
        <p class="set-hint">erases every task, habit, plan and setting on this phone.</p>
        <button class="btn danger set-btn" data-act="reset">${icon('trash', 18)} reset everything</button>
      </div>
    </div>
    <h3 class="set-h">help</h3>
    <div class="set-card set-help">${help}</div>
    <h3 class="set-h">About</h3>
    <div class="set-card"><div class="set-row"><span>to-do</span><span class="set-ver">v${esc(VERSION)}</span></div>${install}</div>
  </div>`;
}

function draw() {
  if (!current) return;
  const body = current.body;
  const scrollers = [body, body.parentElement, body.querySelector('.set-body')].filter(Boolean);
  const tops = scrollers.map((e) => e.scrollTop);
  const snap = focusSnapshot(body); // keep keyboard focus on the same control after the redraw
  body.innerHTML = html();
  scrollers.forEach((e, i) => (e.scrollTop = tops[i]));
  if (snap) focusRestore(body, snap);
}

const set = (k, v) => store.mutate((st) => (st.settings[k] = v));

const PREIMPORT_KEY = 'tempo.v1.preimport';
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Read + validate a backup file. Returns { data } or { error: 'plain-language reason' }; never throws.
async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { error: 'that file is not valid JSON, so it cannot be a to-do backup' };
  }
  if (!isObj(data) || !Array.isArray(data.tasks) || !Array.isArray(data.pages)) return { error: 'that file is not a to-do backup (no tasks or notes found in it)' };
  if (data.sessions !== undefined && !Array.isArray(data.sessions)) return { error: 'that backup is damaged (the focus history is unreadable)' };
  if ([...data.tasks, ...data.pages].some((x) => !isObj(x))) return { error: 'that backup is damaged (some entries are unreadable)' };
  return { data };
}

async function doImport(file) {
  const { data, error } = await readBackup(file);
  if (error) return toast(error, { ms: 6000 });
  const ok = await confirmDialog('this replaces all current tasks, habits and plans with the backup.', { ok: 'replace my data', title: 'import backup?' });
  if (!ok) return;
  // safety copy of what is there now: kept in this phone's storage and offered as "undo" below
  const before = JSON.stringify(store.get());
  try {
    localStorage.setItem(PREIMPORT_KEY, before);
  } catch {
    return toast('could not make a safety copy first, so nothing was imported. export a backup, then try again.', { ms: 7000 });
  }
  try {
    // alerts belong to this phone's push registration, not to the backup (it may come from another phone)
    const { notify, blockAlarms } = store.get().settings;
    store.replaceAll({ ...data, settings: { ...(isObj(data.settings) ? data.settings : {}), notify, blockAlarms } });
    theme.applyTheme();
    if (current && !current.closed) draw();
  } catch (e) {
    console.error(e);
    try {
      store.replaceAll(JSON.parse(before));
    } catch {}
    return toast('the backup could not be applied. your data was kept.', { ms: 6000 });
  }
  toast('backup imported', {
    action: 'undo',
    ms: 10000,
    onAction: () => {
      try {
        store.replaceAll(JSON.parse(before));
        theme.applyTheme();
        if (current && !current.closed) draw();
        toast('import undone');
      } catch {
        toast('could not undo. the previous data is still in this browser under tempo.v1.preimport.', { ms: 8000 });
      }
    },
  });
}

function doExport() {
  const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `todo-backup-${ymd()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openSettings() {
  if (current && !current.closed) return;
  const rec = openSheet(html(), { cls: 'settings', onClose: () => (current = null) });
  current = rec;
  const body = rec.body;

  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return rec.close();
    const th = e.target.closest('button[data-theme]');
    if (th) {
      set('theme', th.dataset.theme);
      theme.applyTheme();
      return draw();
    }
    const ac = e.target.closest('[data-accent]');
    if (ac) {
      set('accent', ac.dataset.accent);
      theme.applyTheme();
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') doExport();
    else if (act === 'import') body.querySelector('[data-file]').click();
    else if (act === 'install') runInstall();
    else if (act === 'sync-connect') {
      const btn = e.target.closest('[data-act]');
      const key = body.querySelector('[data-synckey]')?.value || '';
      btn.disabled = true;
      try {
        const c = await sync.check(key);
        if (!c.ok) return toast(c.why, { ms: 7000 });
        let mode = 'merge';
        if (c.serverHasData) {
          const replace = await confirmDialog('your server already has synced tasks. take them and drop what is on this device, or keep both?', {
            title: 'server already has data',
            ok: 'use server data',
            cancel: 'keep both',
            danger: false,
          });
          if (replace) mode = 'replace';
        }
        const st = await sync.connect(key, mode);
        toast(st.err ? 'connected, but the first sync failed. it retries every minute.' : 'connected. your tasks are synced.', { ms: 6000 });
      } finally {
        btn.disabled = false;
        if (sync.connected()) draw(); // on a refused key keep the field as typed, so it can be fixed
      }
    }
    else if (act === 'sync-now') sync.syncNow();
    else if (act === 'sync-off') {
      const ok = await confirmDialog('this device stops syncing. your data stays on the phone and on the server.', { title: 'stop syncing?', ok: 'disconnect', danger: false });
      if (ok) sync.disconnect();
      draw();
    }
    else if (act === 'reset') {
      const ok = await confirmDialog('all tasks, habits, plans and settings on this phone will be erased. this cannot be undone.', { ok: 'erase everything', title: 'reset to-do?' });
      if (ok) {
        sync.disconnect(); // otherwise the wipe would be synced as "delete everything" on the server too
        store.resetAll(); // stops the app from saving the old data back while it reloads
        location.reload();
      }
    }
  });

  body.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-file]');
    if (f) {
      const file = f.files[0];
      f.value = '';
      if (file) doImport(file);
      return;
    }
    const t = e.target.closest('[data-tog]');
    if (!t) return;
    const k = t.dataset.tog;
    if (k === 'blockAlarms') {
      if (t.checked) {
        const p = await push.enable(); // permission + subscription
        const r = p.ok ? await push.setBlockAlarms(true) : { ok: false, error: p.why };
        if (!r.ok || r.skipped) {
          t.checked = false;
          toast(String(r.error || 'notifications are not allowed for to-do').toLowerCase(), { ms: 8000 });
          return;
        }
        toast('done? alerts are on for your plan blocks');
      } else push.setBlockAlarms(false);
    }
    set(k, t.checked);
  });
}
