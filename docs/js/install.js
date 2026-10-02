// "Install app" support. Chrome only fires `beforeinstallprompt` sometimes, so we always offer a button:
// with the event it opens the real install dialog, without it it shows step-by-step instructions.
import { openSheet } from './ui.js';

let evt = null;
const subs = new Set();
const notify = () => subs.forEach((f) => f());

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const onInstallChange = (f) => subs.add(f);

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  evt = e;
  notify();
});
addEventListener('appinstalled', () => {
  evt = null;
  notify();
});

export async function install() {
  if (evt) {
    const e = evt;
    evt = null;
    try {
      e.prompt();
      await e.userChoice;
    } catch {}
    notify();
    return;
  }
  showHelp();
}

function showHelp() {
  const steps = isIos()
    ? ['Open this page in <b>Safari</b>.', 'Tap the <b>Share</b> button.', 'Choose <b>Add to Home Screen</b>, then <b>Add</b>.']
    : ['Open this page in <b>Chrome</b> (not inside another app such as Instagram or Messenger).', 'Tap the <b>⋮</b> menu at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Confirm with <b>Install</b>. Tempo appears on your home screen.'];
  const rec = openSheet(
    `<h2 class="sh">Install Tempo</h2>
     <ol class="install-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
     <p class="muted sm">If you don't see the option, reload the page once and try again.</p>
     <button class="btn primary" style="width:100%;margin-top:14px" data-close>Got it</button>`,
    { cls: 'small' }
  );
  rec.body.querySelector('[data-close]').onclick = rec.close;
}
