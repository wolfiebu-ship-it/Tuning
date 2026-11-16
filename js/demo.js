// Simulierter Roller: beantwortet echte Protokoll-Frames, damit die App
// ohne Hardware ausprobiert und getestet werden kann.
import { PROTOCOLS, FrameParser, CMD } from './protocol.js';
import { REG } from './registers.js';

export class DemoTransport {
  constructor(brand = 'xiaomi') {
    this.brand = brand;
    this.protocol = PROTOCOLS[brand];
    this.parser = new FrameParser(this.protocol);
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.name = brand === 'xiaomi' ? 'MIScooter-Demo' : 'NBScooter-Demo';
    this.encryptedHint = false;
    this.mem = { esc: new Map(), bms: new Map() };
    this.t0 = Date.now();
    this.totalM = 1234567;
    this.timer = null;
    this.seed();
  }

  setWord(target, reg, v) {
    this.mem[target].set(reg, v & 0xffff);
  }

  setBytes(target, reg, bytes) {
    for (let i = 0; i < bytes.length; i += 2) this.setWord(target, reg + i / 2, bytes[i] | ((bytes[i + 1] ?? 0) << 8));
  }

  seed() {
    const serial = this.brand === 'xiaomi' ? '26341/00123456' : 'N4GSD2049C1234';
    this.setBytes('esc', REG.SERIAL, Array.from(serial, (c) => c.charCodeAt(0)));
    this.setWord('esc', REG.ESC_VERSION, this.brand === 'xiaomi' ? 0x0156 : 0x0154);
    this.setWord('esc', REG.ERROR, 0);
    this.setWord('esc', REG.KERS, 1);
    this.setWord('esc', REG.CRUISE, 0);
    this.setWord('esc', REG.TAILLIGHT, 0);
    this.setWord('bms', REG.BMS_VERSION, 0x0130);
    this.locked = false;
  }

  async connect() {
    this.timer = setInterval(() => this.tick(), 200);
  }

  tick() {
    const t = (Date.now() - this.t0) / 1000;
    const speed = this.locked ? 0 : Math.max(0, 18 + 6 * Math.sin(t / 4) + 1.5 * Math.sin(t * 1.7));
    this.totalM += (speed / 3.6) * 0.2;
    const battery = Math.max(5, 87 - Math.floor(t / 30));
    this.setWord('esc', 0xb0, 0);
    this.setWord('esc', 0xb1, 0);
    this.setWord('esc', 0xb2, this.locked ? 0x02 : 0);
    this.setWord('esc', 0xb4, battery);
    this.setWord('esc', 0xb5, Math.round(speed * 1000));
    this.setWord('esc', 0xb6, 16500);
    this.setWord('esc', 0xb7, Math.round(this.totalM) & 0xffff);
    this.setWord('esc', 0xb8, Math.floor(Math.round(this.totalM) / 0x10000));
    this.setWord('esc', 0xb9, Math.round(t * 1.5));
    this.setWord('esc', 0xba, Math.round(t));
    this.setWord('esc', 0xbb, 310 + Math.round(20 * Math.sin(t / 20)));
    const current = speed > 1 ? Math.round((6 + 4 * Math.sin(t)) * 100) : 0;
    this.setWord('bms', 0x31, Math.round(7800 * battery / 100));
    this.setWord('bms', 0x32, battery);
    this.setWord('bms', 0x33, current);
    const v = 3.3 + 0.9 * (battery / 100);
    this.setWord('bms', 0x34, Math.round(v * 10 * 100));
    this.setWord('bms', 0x35, (20 + 26) | ((20 + 25) << 8));
    for (let i = 0; i < 10; i++) this.setWord('bms', 0x40 + i, Math.round(v * 1000 + (i === 6 ? -18 : 0) + (i % 3) * 4));
  }

  readBytes(target, reg, len) {
    const out = [];
    for (let i = 0; i < Math.ceil(len / 2); i++) {
      const w = this.mem[target].get(reg + i) ?? 0;
      out.push(w & 0xff, (w >> 8) & 0xff);
    }
    return out.slice(0, len);
  }

  async write(bytes) {
    for (const f of this.parser.push(bytes)) {
      const target = f.dest;
      if (!target) continue;
      if (f.cmd === CMD.READ) {
        const payload = this.readBytes(target, f.reg, f.payload[0]);
        setTimeout(() => this.onData(this.protocol.encodeReply({ target, reg: f.reg, payload })), 15 + Math.random() * 30);
      } else if (f.cmd === CMD.XIAOMI_WRITE || f.cmd === CMD.NINEBOT_WRITE) {
        const value = f.payload[0] | (f.payload[1] << 8);
        if (f.reg === REG.LOCK && value === 1) this.locked = true;
        else if (f.reg === REG.UNLOCK && value === 1) this.locked = false;
        else this.setWord(target, f.reg, value);
        if (this.brand === 'ninebot' && f.cmd === CMD.NINEBOT_WRITE) {
          setTimeout(() => this.onData(this.protocol.encodeReply({ target, reg: f.reg, payload: [1], cmd: CMD.NINEBOT_WRITE_REPLY })), 20);
        }
      }
    }
  }

  disconnect() {
    clearInterval(this.timer);
    this.onDisconnect();
  }
}
