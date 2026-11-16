// Verbindung zum Roller: sendet Anfragen nacheinander und ordnet Antworten zu.
import { PROTOCOLS, FrameParser, CMD, toHex } from './protocol.js';
import { decodeReply, REG } from './registers.js';

const TIMEOUT_MS = 600;

export class ScooterSession {
  constructor(transport, brand, { onUpdate = () => {}, onLog = () => {} } = {}) {
    this.transport = transport;
    this.brand = brand;
    this.protocol = PROTOCOLS[brand];
    this.parser = new FrameParser(this.protocol);
    this.onUpdate = onUpdate;
    this.onLog = onLog;
    this.pending = null;
    this.queue = Promise.resolve();
    this.misses = 0;
    transport.onData = (chunk) => this.handleData(chunk);
  }

  handleData(chunk) {
    for (const f of this.parser.push(chunk)) {
      this.onLog('rx', toHex(f.raw));
      if (!f.source) continue; // eigenes Echo o. ä.
      const isReadReply = this.brand === 'xiaomi' ? f.cmd === CMD.READ : f.cmd === CMD.NINEBOT_READ_REPLY;
      if (!isReadReply) continue; // z. B. Schreib-Bestätigung
      const patch = decodeReply(f.source, f.reg, f.payload);
      if (patch) this.onUpdate(patch);
      if (this.pending && this.pending.target === f.source && this.pending.reg === f.reg) {
        const { resolve, timer } = this.pending;
        clearTimeout(timer);
        this.pending = null;
        this.misses = 0;
        resolve(f.payload);
      }
    }
  }

  // Serialisiert Anfragen: der Roller verträgt nur eine gleichzeitig.
  enqueue(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  request(target, reg, bytes, expectReply = true) {
    return this.enqueue(async () => {
      this.onLog('tx', toHex(bytes));
      if (!expectReply) {
        await this.transport.write(bytes);
        return null;
      }
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          this.misses++;
          reject(new Error(`Keine Antwort (${target.toUpperCase()} 0x${reg.toString(16)})`));
        }, TIMEOUT_MS);
        this.pending = { target, reg, resolve, timer };
      });
      await this.transport.write(bytes);
      return reply;
    });
  }

  read(target, reg, len) {
    return this.request(target, reg, this.protocol.read(target, reg, len));
  }

  async readGroup(group) {
    const results = [];
    for (const r of group) {
      try {
        results.push(await this.read(r.target, r.reg, r.len));
      } catch (e) {
        results.push(e);
      }
    }
    return results;
  }

  async write(target, reg, value) {
    const bytes = this.protocol.write(target, reg, value);
    // Xiaomi bestätigt Schreibzugriffe nicht; Ninebot (cmd 0x02) schon, aber
    // das Ack wird nicht zwingend gebraucht.
    await this.request(target, reg, bytes, false);
  }

  async writeSetting(name, value) {
    switch (name) {
      case 'kers':
        return this.write('esc', REG.KERS, value);
      case 'cruise':
        return this.write('esc', REG.CRUISE, value ? 1 : 0);
      case 'taillight':
        return this.write('esc', REG.TAILLIGHT, value ? 2 : 0);
      case 'lock':
        return this.write('esc', value ? REG.LOCK : REG.UNLOCK, 1);
      default:
        throw new Error(`Unbekannte Einstellung: ${name}`);
    }
  }

  disconnect() {
    this.transport.disconnect();
  }
}
