import { BleTransport, bluetoothAvailable, guessBrand } from './ble.js';
import { DemoTransport } from './demo.js';
import { ScooterSession } from './session.js';
import { READS } from './registers.js';
import { MODELS, modelsFor } from './models.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
};

const state = {
  brand: store.get('brand') || 'xiaomi',
  modelId: store.get('model') || null,
  session: null,
  demo: false,
  info: {},
  live: {},
  settings: {},
  battery: {},
  pollTimer: null,
  tab: 'dash',
};

// ---------- Hilfen ----------
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (error ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

const fmt = (v, digits = 1, unit = '') => (v == null || Number.isNaN(v) ? '–' : `${v.toFixed(digits)}${unit}`);

function fmtDuration(s) {
  if (s == null) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}

function currentModel() {
  return MODELS.find((m) => m.id === state.modelId) || modelsFor(state.brand)[0];
}

function setConn(status, label) {
  $('#connDot').className = 'dot' + (status === 'on' ? ' on' : status === 'busy' ? ' busy' : '');
  setText('connLabel', label);
}

// ---------- Verbindungsbildschirm ----------
function renderBrand() {
  $$('#brandSeg button').forEach((b) => b.classList.toggle('active', b.dataset.value === state.brand));
  const sel = $('#modelSelect');
  const models = modelsFor(state.brand);
  sel.innerHTML = models.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  if (!models.some((m) => m.id === state.modelId)) state.modelId = models[0].id;
  sel.value = state.modelId;
  renderModelHint();
}

function renderModelHint() {
  const m = currentModel();
  const cfw = m.cfw
    ? 'Custom Firmware verfügbar.'
    : 'Für dieses Modell gibt es aktuell keine Custom Firmware.';
  const enc = m.encrypted === 'immer' || m.encrypted === 'ab Werk'
    ? `Die Bluetooth-Verbindung ist ${m.encrypted === 'immer' ? 'immer' : 'ab Werk'} verschlüsselt. Ohne BLE-Downgrade bekommst du keine Daten.`
    : `Die Bluetooth-Verbindung ist ${m.encrypted} verschlüsselt. Ältere Firmware funktioniert direkt.`;
  $('#modelHint').textContent = `${cfw} ${enc}`;
  setText('cfwStatus', `${m.name}: ${cfw} ${enc}`);
}

// ---------- Verbinden ----------
async function connect(demo) {
  const transport = demo ? new DemoTransport(state.brand) : new BleTransport();
  setConn('busy', 'Verbinde …');
  try {
    await transport.connect();
  } catch (e) {
    setConn('off', 'Nicht verbunden');
    if (e?.name !== 'NotFoundError') toast(`Verbindung fehlgeschlagen: ${e.message}`, true);
    return;
  }

  // Marke am Gerätenamen erkennen, falls möglich
  const detected = guessBrand(transport.name);
  if (detected && detected !== state.brand) {
    state.brand = detected;
    state.modelId = modelsFor(detected)[0].id;
    renderBrand();
    toast(`Erkannt: ${detected === 'xiaomi' ? 'Xiaomi' : 'Segway-Ninebot'}`);
  }

  state.demo = demo;
  state.info = { device: transport.name };
  state.live = {};
  state.settings = {};
  state.battery = {};

  state.session = new ScooterSession(transport, state.brand, {
    onUpdate: applyPatch,
    onLog: log,
  });
  transport.onDisconnect = () => onDisconnected();

  setConn('on', demo ? 'Demo verbunden' : transport.name);
  $('#screenConnect').hidden = true;
  $('#screenApp').hidden = false;
  renderAll();

  const s = state.session;
  const infoRes = await s.readGroup(READS.info);
  await s.readGroup(READS.settings);
  if (infoRes.every((r) => r instanceof Error)) {
    toast(
      transport.encryptedHint
        ? 'Keine Antwort: Die Firmware deines Rollers ist verschlüsselt. Mach zuerst ein BLE-Downgrade.'
        : 'Der Roller antwortet nicht. Ist er eingeschaltet, und stimmt der Hersteller?',
      true,
    );
  }
  startPolling();
}

function onDisconnected() {
  stopPolling();
  state.session = null;
  setConn('off', 'Nicht verbunden');
  $('#screenApp').hidden = true;
  $('#screenConnect').hidden = false;
  toast('Verbindung getrennt');
}

let polling = false;
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.session || polling) return;
    polling = true;
    try {
      const group = state.tab === 'battery' ? READS.battery : READS.live;
      await state.session.readGroup(group);
      if (state.tab === 'tune') await state.session.readGroup(READS.settings);
    } finally {
      polling = false;
    }
  }, 500);
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// ---------- Zustand & Anzeige ----------
function applyPatch(patch) {
  for (const k of Object.keys(patch)) Object.assign(state[k], patch[k]);
  if (patch.live) renderLive();
  if (patch.info) renderInfo();
  if (patch.settings || patch.live?.locked !== undefined) renderSettings();
  if (patch.battery) renderBattery();
}

function renderAll() {
  renderLive();
  renderInfo();
  renderSettings();
  renderBattery();
}

const ARC_LEN = Math.PI * 80;
function renderLive() {
  const l = state.live;
  const max = 45;
  const speed = Math.abs(l.speed ?? 0);
  const arc = $('#gaugeArc');
  arc.style.strokeDasharray = `${ARC_LEN}`;
  arc.style.strokeDashoffset = `${ARC_LEN * (1 - Math.min(speed, max) / max)}`;
  arc.style.stroke = speed > 20 ? 'var(--danger)' : 'var(--accent)';
  setText('vSpeed', speed.toFixed(1));
  setText('vBattery', l.battery != null ? `${l.battery} %` : '–');
  setText('vTrip', fmt(l.tripKm, 2, ' km'));
  setText('vTotal', fmt(l.totalKm, 1, ' km'));
  setText('vAvg', fmt(l.avgSpeed, 1, ' km/h'));
  setText('vTemp', fmt(l.temperature, 1, ' °C'));
  setText('vUptime', fmtDuration(l.uptime));
}

function renderInfo() {
  const i = state.info;
  setText('iModel', currentModel().name + (state.demo ? ' (Demo)' : ''));
  setText('iDevice', i.device ?? '–');
  setText('iSerial', i.serial ?? '–');
  setText('iEsc', i.escVersion ?? '–');
  setText('iBms', i.bmsVersion ?? '–');
  setText('iError', i.errorCode == null ? '–' : i.errorCode === 0 ? 'Kein Fehler' : `Fehler ${i.errorCode}`);
}

function renderSettings() {
  const s = state.settings;
  $$('#kersSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.value) === s.kers));
  if (s.cruise !== undefined) $('#swCruise').checked = s.cruise;
  if (s.taillight !== undefined) $('#swTail').checked = s.taillight;
  if (state.live.locked !== undefined) $('#swLock').checked = state.live.locked;
}

function renderBattery() {
  const b = state.battery;
  setText('bPercent', b.percent != null ? `${b.percent} %` : '–');
  setText('bVoltage', fmt(b.voltage, 2, ' V'));
  setText('bCurrent', fmt(b.current, 2, ' A'));
  setText('bPower', b.voltage != null && b.current != null ? `${Math.round(b.voltage * b.current)} W` : '–');
  setText('bCapacity', b.capacity != null ? `${b.capacity} mAh` : '–');
  setText('bTemp', b.temps ? `${b.temps[0]} / ${b.temps[1]} °C` : '–');

  const cells = b.cells || [];
  if (!cells.length) {
    $('#cells').innerHTML = '<p class="muted">Noch keine Daten.</p>';
    setText('cellDiff', '');
    return;
  }
  const min = Math.min(...cells);
  const maxV = Math.max(...cells);
  $('#cells').innerHTML = cells
    .map((v, i) => {
      const h = Math.max(6, Math.min(100, ((v - 3.0) / 1.2) * 100));
      const low = maxV - v > 0.05 ? ' low' : '';
      return `<div class="cell${low}"><div class="bar"><i style="height:${h}%"></i></div><b>${v.toFixed(3)}</b><small>Zelle ${i + 1}</small></div>`;
    })
    .join('');
  const diff = Math.round((maxV - min) * 1000);
  setText(
    'cellDiff',
    `Abweichung: ${diff} mV – ${diff <= 30 ? 'gut ausbalanciert' : diff <= 80 ? 'leicht unausgeglichen' : 'deutlich unausgeglichen, Akku prüfen lassen'}`,
  );
}

// ---------- Einstellungen schreiben ----------
async function setSetting(name, value) {
  if (!state.session) return;
  try {
    await state.session.writeSetting(name, value);
    if (name === 'lock') state.live.locked = value;
    else state.settings[name] = value;
    renderSettings();
    // Gegenlesen, ob der Roller den Wert übernommen hat
    setTimeout(() => state.session?.readGroup(READS.settings), 300);
  } catch (e) {
    toast(e.message, true);
  }
}

const PRESETS = {
  range: { kers: 2, cruise: true },
  comfort: { kers: 0, cruise: true },
  city: { kers: 1, cruise: false, taillight: true },
};

async function applyPreset(id) {
  for (const [k, v] of Object.entries(PRESETS[id])) await setSetting(k, v);
  toast('Profil übernommen');
}

// ---------- Experte ----------
function log(dir, hex) {
  const el = $('#log');
  if (!el || state.tab !== 'expert') return;
  const line = `${new Date().toLocaleTimeString()} ${dir === 'tx' ? '→' : '←'} ${hex}\n`;
  el.textContent = (el.textContent + line).split('\n').slice(-200).join('\n');
  el.scrollTop = el.scrollHeight;
}

function parseHex(str, max) {
  const v = parseInt(String(str).trim().replace(/^0x/i, ''), 16);
  return Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

async function regRead() {
  const reg = parseHex($('#regAddr').value, 0xff);
  const len = parseInt($('#regLen').value, 10);
  if (reg == null || !(len > 0 && len <= 64)) return toast('Register (00–FF) und Länge (1–64) prüfen', true);
  try {
    const p = await state.session.read($('#regTarget').value, reg, len);
    const words = [];
    for (let i = 0; i + 1 < p.length; i += 2) words.push(`0x${(reg + i / 2).toString(16).toUpperCase()}: ${(p[i] | (p[i + 1] << 8)).toString(16).padStart(4, '0')}`);
    $('#regResult').textContent = words.join('\n') || Array.from(p, (b) => b.toString(16).padStart(2, '0')).join(' ');
  } catch (e) {
    $('#regResult').textContent = e.message;
  }
}

async function regWrite() {
  const reg = parseHex($('#regAddr').value, 0xff);
  const val = parseHex($('#regValue').value, 0xffff);
  if (reg == null || val == null) return toast('Register (00–FF) und Wert (0000–FFFF) prüfen', true);
  const target = $('#regTarget').value;
  if (!confirm(`Wirklich 0x${val.toString(16)} in ${target.toUpperCase()}-Register 0x${reg.toString(16)} schreiben?`)) return;
  await state.session.write(target, reg, val);
  $('#regResult').textContent = 'Gesendet.';
}

// ---------- Events ----------
function bind() {
  $$('#brandSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.brand = b.dataset.value;
      store.set('brand', state.brand);
      renderBrand();
    }),
  );
  $('#modelSelect').addEventListener('change', (e) => {
    state.modelId = e.target.value;
    store.set('model', state.modelId);
    renderModelHint();
  });
  $('#btnConnect').addEventListener('click', () => connect(false));
  $('#btnDemo').addEventListener('click', () => connect(true));
  $('#btnDisconnect').addEventListener('click', () => state.session?.disconnect());

  $$('#tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => (t.hidden = t.dataset.tab !== state.tab));
      if (state.tab === 'tune') state.session?.readGroup(READS.settings);
    }),
  );

  $$('#kersSeg button').forEach((b) => b.addEventListener('click', () => setSetting('kers', Number(b.dataset.value))));
  $('#swCruise').addEventListener('change', (e) => setSetting('cruise', e.target.checked));
  $('#swTail').addEventListener('change', (e) => setSetting('taillight', e.target.checked));
  $('#swLock').addEventListener('change', (e) => setSetting('lock', e.target.checked));
  $$('.preset').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

  $('#btnRegRead').addEventListener('click', regRead);
  $('#btnRegWrite').addEventListener('click', regWrite);
  $('#btnClearLog').addEventListener('click', () => ($('#log').textContent = ''));
}

function init() {
  bind();
  renderBrand();
  if (!bluetoothAvailable()) {
    $('#bleWarning').hidden = false;
    $('#btnConnect').disabled = true;
  }
  if (store.get('disclaimer') !== 'ok') {
    const d = $('#disclaimer');
    d.addEventListener('close', () => store.set('disclaimer', 'ok'));
    d.showModal?.();
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
