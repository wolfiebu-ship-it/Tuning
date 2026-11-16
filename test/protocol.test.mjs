import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Xiaomi, Ninebot, FrameParser, toHex } from '../js/protocol.js';
import { decodeReply, REG, READS } from '../js/registers.js';
import { DemoTransport } from '../js/demo.js';
import { ScooterSession } from '../js/session.js';

test('Xiaomi: Seriennummer lesen ergibt bekannten Frame', () => {
  // bekannter Frame aus der M365-Community-Doku
  assert.equal(toHex(Xiaomi.read('esc', 0x10, 0x0e)), '55 aa 03 20 01 10 0e bd ff');
});

test('Ninebot: Leseanfrage hat korrekten Aufbau und Prüfsumme', () => {
  const f = Ninebot.read('esc', 0xb0, 0x20);
  assert.deepEqual(Array.from(f.slice(0, 8)), [0x5a, 0xa5, 0x01, 0x3e, 0x20, 0x01, 0xb0, 0x20]);
  const sum = [0x01, 0x3e, 0x20, 0x01, 0xb0, 0x20].reduce((a, b) => a + b, 0);
  const ck = ~sum & 0xffff;
  assert.deepEqual([f[8], f[9]], [ck & 0xff, ck >> 8]);
});

test('Parser setzt zerstückelte Frames wieder zusammen und ignoriert Müll', () => {
  const reply = Xiaomi.encodeReply({ target: 'esc', reg: REG.KERS, payload: [2, 0, 1, 0, 2, 0] });
  const p = new FrameParser(Xiaomi);
  assert.equal(p.push(Uint8Array.from([0x00, 0x55, ...reply.slice(0, 5)])).length, 0);
  const out = p.push(reply.slice(5));
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'esc');
  assert.deepEqual(decodeReply('esc', out[0].reg, out[0].payload), {
    settings: { kers: 2, cruise: true, taillight: true },
  });
});

test('Parser verwirft Frames mit falscher Prüfsumme', () => {
  const reply = Ninebot.encodeReply({ target: 'bms', reg: 0x31, payload: [1, 2] });
  reply[reply.length - 1] ^= 0xff;
  assert.equal(new FrameParser(Ninebot).push(reply).length, 0);
});

for (const brand of ['xiaomi', 'ninebot']) {
  test(`${brand}: kompletter Ablauf mit Demo-Roller`, async () => {
    const t = new DemoTransport(brand);
    t.tick();
    const state = {};
    const s = new ScooterSession(t, brand, {
      onUpdate: (p) => { for (const k in p) state[k] = { ...state[k], ...p[k] }; },
    });
    await s.readGroup([...READS.info, ...READS.live, ...READS.settings, ...READS.battery]);
    assert.match(state.info.serial, /^[\w/]{10,}$/);
    assert.ok(state.live.speed > 0);
    assert.equal(state.battery.cells.length, 10);
    assert.equal(state.settings.kers, 1);

    await s.writeSetting('kers', 2);
    await s.writeSetting('cruise', true);
    await s.writeSetting('lock', true);
    await new Promise((r) => setTimeout(r, 50));
    t.tick();
    await s.readGroup([...READS.settings, ...READS.live]);
    assert.equal(state.settings.kers, 2);
    assert.equal(state.settings.cruise, true);
    assert.equal(state.live.locked, true);
    assert.equal(state.live.speed, 0);
    t.disconnect();
  });
}
