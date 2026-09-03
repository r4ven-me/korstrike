'use strict';

let sessionExpiredHandled = false;

const api = async (path, opts = {}) => {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    if (!sessionExpiredHandled) {
      sessionExpiredHandled = true;
      showLogin(t('session.expired'));
    }
    throw new Error(data.error || 'not authenticated');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

const loginScreen = document.getElementById('login-screen');
const appEl = document.getElementById('app');

function showApp() {
  sessionExpiredHandled = false;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  init();
}

function showLogin(message) {
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  document.getElementById('login-error').textContent = message || '';
}

// --- Theme (system by default; explicit choice persists) ---
function getStoredTheme() {
  return localStorage.getItem('korstrike-theme');
}

function effectiveTheme() {
  return getStoredTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme() {
  const stored = getStoredTheme();
  if (stored) document.documentElement.dataset.theme = stored;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = effectiveTheme() === 'dark' ? '🌙' : '☀️';
}

function toggleTheme() {
  localStorage.setItem('korstrike-theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
}

// --- Language (English by default) ---
function toggleLang() {
  setLang(getLang() === 'en' ? 'ru' : 'en');
  applyStaticTranslations();
  refreshDynamicContent();
}

applyTheme();
applyStaticTranslations();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('lang-toggle').addEventListener('click', toggleLang);

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  try {
    await api('/login', { method: 'POST', body: { username, password } });
    showApp();
  } catch (err) {
    showLogin(err.message);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

api('/me')
  .then((d) => (d.user ? showApp() : showLogin()))
  .catch(() => showLogin());

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'activity') loadActivity();
    if (btn.dataset.tab === 'bans') loadBansLists();
    if (btn.dataset.tab === 'map') loadMaps();
    if (btn.dataset.tab === 'settings') loadCvars();
  });
});

let initialized = false;

function init() {
  connectWs();
  loadMaps();
  loadCvars();
  loadActivity();
  loadBansLists();
  if (!initialized) {
    initialized = true;
    document.getElementById('map-apply').addEventListener('click', onMapApply);
    document.getElementById('map-manual-apply').addEventListener('click', onMapManualApply);
    document.getElementById('map-download-apply').addEventListener('click', onMapDownloadApply);
    document.getElementById('ban-steamid-apply').addEventListener('click', onBanSteamId);
    document.getElementById('unban-steamid-apply').addEventListener('click', onUnbanSteamId);
    document.getElementById('ban-ip-apply').addEventListener('click', onBanIp);
    document.getElementById('unban-ip-apply').addEventListener('click', onUnbanIp);
    document.getElementById('server-password-apply').addEventListener('click', onPasswordApply);
    document.getElementById('restart-server-btn').addEventListener('click', onRestartServer);
    document.getElementById('stop-server-btn').addEventListener('click', onStopServer);
    document.getElementById('start-server-btn').addEventListener('click', onStartServer);
    document.getElementById('console-run').addEventListener('click', onConsoleRun);
    document.getElementById('bots-add-btn').addEventListener('click', onBotAdd);
    document.getElementById('bots-kick-btn').addEventListener('click', onBotKick);
    document.getElementById('bots-kickall-btn').addEventListener('click', onBotKickAll);
  }
}

function refreshDynamicContent() {
  if (lastStatus) renderStatus(lastStatus);
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'settings') loadCvars();
  if (activeTab === 'activity') loadActivity();
}

// --- Live status via WebSocket ---
let ws = null;
let lastStatus = null;

async function connectWs() {
  try {
    const { token } = await api('/ws-token');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    ws.onmessage = (evt) => renderStatus(JSON.parse(evt.data));
    ws.onclose = () => {
      setDot(false);
      setTimeout(connectWs, 3000);
    };
    ws.onerror = () => ws.close();
  } catch {
    setDot(false);
    setTimeout(connectWs, 3000);
  }
}

function setDot(ok) {
  document.getElementById('conn-dot').classList.toggle('ok', ok);
}

function updatePowerUI(stopped) {
  const badge = document.getElementById('power-badge');
  if (!badge) return;
  badge.textContent = stopped ? t('settings.stoppedBadge') : t('settings.runningBadge');
  document.getElementById('stop-server-btn').disabled = stopped;
  document.getElementById('start-server-btn').disabled = !stopped;
}

function renderStatus(status) {
  lastStatus = status;
  updatePowerUI(status.stopped);

  if (status.stopped) {
    setDot(false);
    document.getElementById('info-hostname').textContent = '—';
    document.getElementById('info-map').textContent = t('settings.stoppedBadge');
    document.getElementById('info-players').textContent = '';
    document.getElementById('bots-count').textContent = '—';
    document.getElementById('players-body').innerHTML =
      `<tr><td colspan="7" class="muted">${t('players.stoppedMessage')}</td></tr>`;
    return;
  }

  setDot(!status.error);
  document.getElementById('info-hostname').textContent = status.hostname || '—';
  document.getElementById('info-map').textContent = t('common.map', { map: status.map || '—' });
  document.getElementById('info-players').textContent = t('common.playersCount', {
    count: `${status.playersActive ?? 0}${status.maxPlayers ? ' / ' + status.maxPlayers : ''}`,
  });

  // YaPB bots always show up with the literal uniqueid "BOT" (standard
  // GoldSrc behavior for any fake/plugin-controlled client) — that's how
  // bot rows are told apart from real players, no separate tracking needed.
  const botsCount = status.players ? status.players.filter((p) => p.steamid === 'BOT').length : 0;
  document.getElementById('bots-count').textContent = t('players.botsCount', { count: botsCount });

  const body = document.getElementById('players-body');
  if (!status.players || status.players.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="muted">${t('players.none')}</td></tr>`;
    return;
  }
  body.innerHTML = '';
  for (const p of status.players) {
    const isBot = p.steamid === 'BOT';
    const tr = document.createElement('tr');
    const ip = (p.address || '').split(':')[0];
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.steamid)}</td>
      <td>${escapeHtml(ip)}</td>
      <td>${p.ping}</td>
      <td>${escapeHtml(p.time)}</td>
      <td>${p.frags}</td>
      <td></td>
    `;
    const actionsCell = tr.lastElementChild;

    const kickBtn = document.createElement('button');
    kickBtn.className = 'kick-btn';
    kickBtn.textContent = t('players.kick');
    kickBtn.onclick = async () => {
      await api('/kick', { method: 'POST', body: { userid: p.userid } }).catch(alert);
    };
    actionsCell.appendChild(kickBtn);

    // Banning is meaningless for bots — they all share the placeholder
    // "BOT" uniqueid and have no real IP, so skip the Ban button for them.
    if (!isBot) {
      const banBtn = document.createElement('button');
      banBtn.className = 'ban-btn';
      banBtn.textContent = t('players.ban');
      banBtn.onclick = async () => {
        if (!confirm(t('players.confirmBan', { name: p.name, steamid: p.steamid }))) return;
        await api('/ban/steamid', { method: 'POST', body: { steamid: p.steamid, minutes: 0 } }).catch(alert);
        if (ip) await api('/ban/ip', { method: 'POST', body: { ip, minutes: 0 } }).catch(alert);
        loadBansLists();
      };
      actionsCell.appendChild(banBtn);
    }

    body.appendChild(tr);
  }
}

// --- Bots (YaPB) ---
async function onBotAdd() {
  await api('/bots/add', { method: 'POST' }).catch(alert);
}

async function onBotKick() {
  await api('/bots/kick', { method: 'POST' }).catch(alert);
}

async function onBotKickAll() {
  if (!confirm(t('players.botsKickAllConfirm'))) return;
  await api('/bots/kick_all', { method: 'POST' }).catch(alert);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- Map tab ---
async function loadMaps() {
  try {
    const { maps } = await api('/maps');
    const select = document.getElementById('map-select');
    select.innerHTML = maps.map((m) => `<option value="${m}">${m}</option>`).join('');
  } catch (err) {
    document.getElementById('map-output').textContent = t('map.loadError', { error: err.message });
  }
}

async function applyMap(map) {
  const out = document.getElementById('map-output');
  out.textContent = t('map.changing');
  try {
    const res = await api('/map', { method: 'POST', body: { map } });
    out.textContent = res.output || 'OK';
  } catch (err) {
    out.textContent = t('console.error', { error: err.message });
  }
}

function onMapApply() {
  applyMap(document.getElementById('map-select').value);
}

function onMapManualApply() {
  const map = document.getElementById('map-manual').value.trim();
  if (!map) return;
  applyMap(map);
}

async function onMapDownloadApply() {
  const name = document.getElementById('map-download-name').value.trim();
  const url = document.getElementById('map-download-url').value.trim();
  const out = document.getElementById('map-download-output');
  if (!name || !url) return;
  out.textContent = t('map.downloading');
  try {
    const res = await api('/maps/download', { method: 'POST', body: { name, url } });
    out.textContent = t('map.downloadSuccess', { files: res.files.join(', ') });
    loadMaps();
  } catch (err) {
    out.textContent = t('console.error', { error: err.message });
  }
}

// --- Bans tab ---
async function loadBansLists() {
  try {
    const { raw } = await api('/bans/steamid');
    document.getElementById('bans-steamid-list').textContent = raw || t('common.empty');
  } catch { /* ignore */ }
  try {
    const { raw } = await api('/bans/ip');
    document.getElementById('bans-ip-list').textContent = raw || t('common.empty');
  } catch { /* ignore */ }
}

async function onBanSteamId() {
  const steamid = document.getElementById('ban-steamid').value.trim();
  const minutes = Number(document.getElementById('ban-steamid-minutes').value || 0);
  if (!steamid) return;
  await api('/ban/steamid', { method: 'POST', body: { steamid, minutes } }).catch(alert);
  loadBansLists();
}

async function onUnbanSteamId() {
  const steamid = document.getElementById('unban-steamid').value.trim();
  if (!steamid) return;
  await api('/unban/steamid', { method: 'POST', body: { steamid } }).catch(alert);
  loadBansLists();
}

async function onBanIp() {
  const ip = document.getElementById('ban-ip').value.trim();
  const minutes = Number(document.getElementById('ban-ip-minutes').value || 0);
  if (!ip) return;
  await api('/ban/ip', { method: 'POST', body: { ip, minutes } }).catch(alert);
  loadBansLists();
}

async function onUnbanIp() {
  const ip = document.getElementById('unban-ip').value.trim();
  if (!ip) return;
  await api('/unban/ip', { method: 'POST', body: { ip } }).catch(alert);
  loadBansLists();
}

// --- Settings tab ---
async function onPasswordApply() {
  const password = document.getElementById('server-password').value;
  await api('/password', { method: 'POST', body: { password } }).catch(alert);
}

function isTruthyCvarValue(value) {
  return parseFloat(value) !== 0;
}

async function loadCvars() {
  const container = document.getElementById('cvars-list');
  container.innerHTML = `<p class="muted">${t('common.loading')}</p>`;

  const lang = getLang();
  const [{ cvars }, valuesRes] = await Promise.all([
    api('/cvars'),
    api('/cvars/values').catch(() => ({ values: {} })),
  ]);
  const values = valuesRes.values || {};

  const groups = new Map();
  for (const [name, meta] of Object.entries(cvars)) {
    const group = (meta.group && meta.group[lang]) || (meta.group && meta.group.en) || name;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([name, meta]);
  }

  container.innerHTML = '';
  for (const [group, entries] of groups) {
    const heading = document.createElement('h3');
    heading.textContent = group;
    container.appendChild(heading);

    for (const [name, meta] of entries) {
      const currentValue = values[name];
      const row = document.createElement('div');
      row.className = 'cvar-row';

      const label = document.createElement('label');
      label.textContent = (meta.label && meta.label[lang]) || (meta.label && meta.label.en) || name;
      label.title = (meta.hint && meta.hint[lang]) || (meta.hint && meta.hint.en) || '';
      label.className = 'cvar-label';

      const currentEl = document.createElement('span');
      currentEl.className = 'cvar-current';
      currentEl.textContent = currentValue === null || currentValue === undefined
        ? t('settings.cvarNA')
        : t('settings.cvarCurrent', { value: currentValue });

      row.appendChild(label);

      if (meta.readonly) {
        const badge = document.createElement('span');
        badge.className = 'cvar-readonly-badge';
        badge.textContent = t('settings.readonly');
        row.appendChild(badge);
        row.appendChild(currentEl);
        container.appendChild(row);
        continue;
      }

      let input = document.createElement('input');
      if (meta.type === 'bool') {
        input.type = 'checkbox';
        input.checked = isTruthyCvarValue(currentValue);
      } else if (meta.type === 'text') {
        input.type = 'text';
        input.value = currentValue ?? '';
      } else {
        input.type = 'number';
        if (meta.step) input.step = meta.step;
        input.value = currentValue ?? '';
      }
      input.id = `cvar-${name}`;

      const button = document.createElement('button');
      button.textContent = t('settings.apply');
      button.addEventListener('click', async () => {
        const value = meta.type === 'bool' ? (input.checked ? '1' : '0') : input.value;
        try {
          await api(`/cvars/${name}`, { method: 'POST', body: { value } });
          currentEl.textContent = t('settings.cvarCurrent', { value });
        } catch (err) {
          alert(err.message);
        }
      });

      row.appendChild(input);
      row.appendChild(currentEl);
      row.appendChild(button);
      container.appendChild(row);
    }
  }
}

async function onRestartServer() {
  if (!confirm(t('settings.restartConfirm'))) return;
  const status = document.getElementById('restart-status');
  const btn = document.getElementById('restart-server-btn');
  btn.disabled = true;
  status.textContent = t('settings.restarting');
  try {
    await api('/restart', { method: 'POST' });
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      try {
        const s = await api('/status');
        if (!s.error) {
          clearInterval(poll);
          status.textContent = t('settings.restartOnline');
          btn.disabled = false;
          setTimeout(() => (status.textContent = ''), 4000);
        }
      } catch { /* keep waiting */ }
      if (attempts > 20) {
        clearInterval(poll);
        status.textContent = t('settings.restartUnknown');
        btn.disabled = false;
      }
    }, 1500);
  } catch (err) {
    status.textContent = t('console.error', { error: err.message });
    btn.disabled = false;
  }
}

async function onStopServer() {
  if (!confirm(t('settings.stopConfirm'))) return;
  const status = document.getElementById('power-status');
  status.textContent = t('settings.stopping');
  try {
    await api('/server/stop', { method: 'POST' });
    status.textContent = '';
  } catch (err) {
    status.textContent = t('console.error', { error: err.message });
  }
}

async function onStartServer() {
  const status = document.getElementById('power-status');
  status.textContent = t('settings.starting');
  try {
    await api('/server/start', { method: 'POST' });
    status.textContent = '';
  } catch (err) {
    status.textContent = t('console.error', { error: err.message });
  }
}

// --- Console tab ---
async function onConsoleRun() {
  const input = document.getElementById('console-input');
  const out = document.getElementById('console-output');
  const command = input.value.trim();
  if (!command) return;
  out.textContent = t('console.running');
  try {
    const res = await api('/console', { method: 'POST', body: { command } });
    out.textContent = res.output || t('console.noOutput');
  } catch (err) {
    out.textContent = t('console.error', { error: err.message });
  }
}

// --- Activity tab ---
async function loadActivity() {
  const { entries } = await api('/audit');
  const body = document.getElementById('activity-body');
  const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
  body.innerHTML = entries
    .map(
      (e) => `<tr>
        <td>${new Date(e.ts).toLocaleString(locale)}</td>
        <td>${escapeHtml(e.user)}</td>
        <td>${escapeHtml(e.action)}</td>
        <td>${escapeHtml(JSON.stringify(e.detail))}</td>
      </tr>`
    )
    .join('');
}
