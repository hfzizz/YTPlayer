'use strict';

/* global YTMiniSettings */

const ALL_SITES = { origins: ['<all_urls>'] };
const fields = [...document.querySelectorAll('[data-setting]')];
const overlayToggle = document.getElementById('overlay-toggle');
const permissionNote = document.getElementById('overlay-permission');
const savedNote = document.getElementById('saved');
let savedTimer = 0;

function render(settings) {
  for (const field of fields) {
    const value = settings[field.dataset.setting];
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value;
  }
  updatePermissionNote();
}

async function updatePermissionNote() {
  const granted = await browser.permissions.contains(ALL_SITES);
  permissionNote.hidden = granted || !overlayToggle.checked;
}

function flashSaved() {
  savedNote.textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedNote.textContent = ''), 1500);
}

async function save(field) {
  const key = field.dataset.setting;
  const value = field.type === 'checkbox' ? field.checked : field.value;
  await YTMiniSettings.set({ [key]: value });
  if (key === 'overlayCorner') await browser.storage.local.remove('overlayPos');
  flashSaved();
}

for (const field of fields) {
  field.addEventListener('change', () => {
    // permissions.request must run synchronously inside the user's click.
    if (field === overlayToggle && field.checked) {
      browser.permissions.request(ALL_SITES).finally(updatePermissionNote);
    }
    save(field).then(updatePermissionNote);
  });
}

document.getElementById('grant').addEventListener('click', (e) => {
  e.preventDefault();
  browser.permissions.request(ALL_SITES).finally(updatePermissionNote);
});

async function renderShortcuts() {
  const list = document.getElementById('shortcuts');
  const commands = await browser.commands.getAll();
  list.replaceChildren(
    ...commands.map((c) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = c.description || c.name;
      const key = document.createElement('kbd');
      key.textContent = c.shortcut || 'Not set';
      li.append(name, key);
      return li;
    })
  );

  if (typeof browser.commands.openShortcutSettings === 'function') {
    const btn = document.getElementById('manage-shortcuts');
    btn.hidden = false;
    btn.addEventListener('click', () => browser.commands.openShortcutSettings());
  }
}

YTMiniSettings.get().then(render);
YTMiniSettings.onChange(render);
browser.permissions.onAdded.addListener(updatePermissionNote);
browser.permissions.onRemoved.addListener(updatePermissionNote);
renderShortcuts();

// Live "Zen mod detected" status, from the background's env messages.
(function watchZenMod() {
  const status = document.getElementById('zen-status');
  const port = browser.runtime.connect({ name: 'ui' });
  port.onMessage.addListener((msg) => {
    if (msg.type !== 'env') return;
    status.textContent = msg.zenMod
      ? 'Zen mod detected: Search and Queue are available on Zen\'s media card.'
      : 'Zen mod not detected.';
  });
  port.onDisconnect.addListener(() => setTimeout(watchZenMod, 1000));
})();
