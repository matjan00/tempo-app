// Settings sheet: appearance, timer, toggles, data backup, about.
import * as store from './store.js';
import * as theme from './theme.js';
import { openSheet, sheetHeader, closeBtn, confirmDialog, toast } from './ui.js';
import { esc, ymd } from './util.js';
import { VERSION } from './version.js';
import * as push from './push.js';
import { install as runInstall, isStandalone, onInstallChange } from './install.js';

let current = null; // open sheet record

onInstallChange(() => current && !current.closed && draw());

const STEPPERS = [
  { k: 'focus', label: 'Focus', min: 5, max: 90, step: 5, unit: 'min' },
  { k: 'short', label: 'Short break', min: 1, max: 30, step: 1, unit: 'min' },
  { k: 'long', label: 'Long break', min: 5, max: 60, step: 5, unit: 'min' },
  { k: 'every', label: 'Long break every', min: 2, max: 8, step: 1, unit: 'sessions' },
  { k: 'goal', label: 'Daily goal', min: 1, max: 16, step: 1, unit: 'sessions' },
];

const TOGGLES = [
  { k: 'autoStart', label: 'Auto-start next session' },
  { k: 'sound', label: 'Sound' },
  { k: 'vibrate', label: 'Vibrate' },
  { k: 'keepAwake', label: 'Keep screen on while running' },
  { k: 'notify', label: 'Ring when phone is locked', hint: 'Sends a notification at the exact end time, even if Tempo is closed. Needs notification permission; make sure the phone is not on silent.' },
];

const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];


function html() {
  const s = store.get().settings;
  const seg = THEMES.map(([v, l]) => `<button data-theme="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('');
  const sw = Object.entries(theme.ACCENTS)
    .map(([id, a]) => {
      const bg = a.c || 'conic-gradient(#18181b 50%, #f2f2f3 0)';
      return `<button class="set-sw ${s.accent === id ? 'on' : ''}" data-accent="${id}" style="background:${bg}" aria-label="${esc(a.name)}" title="${esc(a.name)}"></button>`;
    })
    .join('');
  const steps = STEPPERS.map(
    (p) => `<div class="set-row"><span>${p.label}</span><div class="set-step"><button data-step="${p.k}" data-d="-1" aria-label="Decrease">&minus;</button><output><b>${s[p.k]}</b> <small>${p.unit}</small></output><button data-step="${p.k}" data-d="1" aria-label="Increase">+</button></div></div>`
  ).join('');
  const tog = TOGGLES.map(
    (t) => `<div class="set-row set-tog"><label><span>${t.label}</span><span class="switch"><input type="checkbox" data-tog="${t.k}" ${s[t.k] ? 'checked' : ''}><i></i></span></label>${t.hint ? `<p class="set-hint">${t.hint}</p>` : ''}</div>`
  ).join('');
  const test = push.enabled() ? `<button class="btn ghost set-btn" data-act="testpush">Test: ring in 10 seconds</button>` : push.configured() ? '' : `<p class="set-hint">Locked-phone alarm is not set up yet.</p>`;
  const install = isStandalone() ? '' : `<button class="btn primary set-btn" data-act="install">Install app</button>`;
  return `${sheetHeader('Settings', closeBtn())}
  <div class="set-body">
    <h4 class="set-h">Appearance</h4>
    <div class="set-card"><div class="set-seg">${seg}</div><div class="set-swatches">${sw}</div></div>
    <h4 class="set-h">Timer</h4>
    <div class="set-card">${steps}</div>
    <div class="set-card">${tog}${test}</div>
    <h4 class="set-h">Data</h4>
    <div class="set-card">
      <p class="set-hint">Everything is stored only on this phone. Export a backup now and then.</p>
      <div class="set-btns"><button class="btn ghost set-btn" data-act="export">Export backup</button><button class="btn ghost set-btn" data-act="import">Import backup</button></div>
      <input type="file" accept="application/json,.json" hidden data-file>
      <button class="btn danger set-btn" data-act="reset">Reset everything</button>
    </div>
    <h4 class="set-h">About</h4>
    <div class="set-card"><div class="set-row"><span>to-do</span><span class="set-ver">v${esc(VERSION)}</span></div>${install}</div>
  </div>`;
}

function draw() {
  if (!current) return;
  const body = current.body;
  const scrollers = [body, body.parentElement, body.querySelector('.set-body')].filter(Boolean);
  const tops = scrollers.map((e) => e.scrollTop);
  body.innerHTML = html();
  scrollers.forEach((e, i) => (e.scrollTop = tops[i]));
}

const set = (k, v) => store.mutate((st) => (st.settings[k] = v));

async function doImport(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.pages)) throw new Error('bad');
    const ok = await confirmDialog('This replaces all current tasks, notes and stats with the backup.', { ok: 'Replace', title: 'Import backup?' });
    if (!ok) return;
    store.replaceAll(data);
    theme.applyTheme();
    draw();
    toast('Backup imported');
  } catch {
    toast('That file is not a valid Tempo backup');
  }
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
    const stp = e.target.closest('[data-step]');
    if (stp) {
      const p = STEPPERS.find((x) => x.k === stp.dataset.step);
      const cur = store.get().settings[p.k];
      const n = Math.min(p.max, Math.max(p.min, cur + p.step * Number(stp.dataset.d)));
      if (n !== cur) set(p.k, n);
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') doExport();
    else if (act === 'import') body.querySelector('[data-file]').click();
    else if (act === 'install') runInstall();
    else if (act === 'testpush') {
      await push.schedule(Date.now() + 10000, 'to-do test', 'If you see this, locked-phone alarms work.');
      toast('Lock your phone now. It should ring in about 10–20 seconds.', { ms: 6000 });
    }
    else if (act === 'reset') {
      const ok = await confirmDialog('All tasks, notes, sessions and settings on this phone will be erased. This cannot be undone.', { ok: 'Erase everything', title: 'Reset to-do?' });
      if (ok) {
        try {
          localStorage.removeItem('tempo.v1');
        } catch {}
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
    if (k === 'notify' && t.checked) {
      let ok = false;
      let why = 'Notifications are not available on this device yet.';
      if (push.supported()) {
        const r = await push.enable();
        ok = r.ok;
        why = r.why || why;
      } else {
        try {
          ok = 'Notification' in window && (await Notification.requestPermission()) === 'granted';
        } catch {}
      }
      if (!ok) {
        set('notify', false);
        toast(why, { ms: 9000 });
        return draw();
      }
    }
    if (k === 'notify' && !t.checked) push.disable();
    set(k, t.checked);
  });
}
