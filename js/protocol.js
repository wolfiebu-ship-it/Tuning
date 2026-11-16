// Serielles Protokoll der Xiaomi- und Segway-Ninebot-Roller (unverschlüsselte Variante).
// Beide Hersteller nutzen dieselbe Register-Map im ESC (Motorcontroller) und BMS,
// unterscheiden sich aber im Rahmenformat.
//
// Xiaomi:  55 AA | len | addr | cmd | reg | payload… | ck_lo ck_hi   (len = payload + 2)
// Ninebot: 5A A5 | len | src | dst | cmd | reg | payload… | ck_lo ck_hi (len = payload)
// Prüfsumme: (~Summe aller Bytes ab "len" bis Ende Payload) & 0xFFFF, Little Endian.

export const TARGET = { ESC: 'esc', BMS: 'bms' };

export const CMD = {
  READ: 0x01,
  XIAOMI_WRITE: 0x03,
  NINEBOT_WRITE: 0x02, // Schreiben mit Bestätigung
  NINEBOT_READ_REPLY: 0x04,
  NINEBOT_WRITE_REPLY: 0x05,
};

const XIAOMI_ADDR = { esc: 0x20, bms: 0x22 };
const XIAOMI_REPLY = { 0x23: 'esc', 0x25: 'bms' };
const NINEBOT_ADDR = { esc: 0x20, bms: 0x22 };
const NINEBOT_REPLY = { 0x20: 'esc', 0x22: 'bms' };
export const NINEBOT_APP_ADDR = 0x3e;

export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum += b;
  const ck = ~sum & 0xffff;
  return [ck & 0xff, (ck >> 8) & 0xff];
}

function u8(arr) {
  return Uint8Array.from(arr);
}

export const Xiaomi = {
  name: 'xiaomi',
  header: [0x55, 0xaa],

  encode({ target, cmd, reg, payload = [] }) {
    const body = [payload.length + 2, XIAOMI_ADDR[target], cmd, reg, ...payload];
    return u8([0x55, 0xaa, ...body, ...checksum(body)]);
  },

  // Antwort-Frame (vom Roller) für den Demo-Modus erzeugen.
  encodeReply({ target, reg, payload }) {
    const addr = target === 'bms' ? 0x25 : 0x23;
    const body = [payload.length + 2, addr, CMD.READ, reg, ...payload];
    return u8([0x55, 0xaa, ...body, ...checksum(body)]);
  },

  read(target, reg, length) {
    return this.encode({ target, cmd: CMD.READ, reg, payload: [length] });
  },

  write(target, reg, value16) {
    return this.encode({ target, cmd: CMD.XIAOMI_WRITE, reg, payload: [value16 & 0xff, (value16 >> 8) & 0xff] });
  },

  // Aus einem Rohframe (ohne Header-Prüfung) ein Paket machen.
  // Gibt { frameLength } zurück, wenn genug Daten da sind.
  frameLength(buf, i) {
    if (buf.length < i + 3) return null;
    return buf[i + 2] + 6; // hdr(2) + len(1) + addr(1) + cmd(1) + reg(1) + payload(len-2) + ck(2)
  },

  decodeFrame(frame) {
    const len = frame[2];
    const body = Array.from(frame.slice(2, 2 + 1 + len + 1)); // len, addr, cmd, reg, payload
    const ck = checksum(body);
    if (ck[0] !== frame[frame.length - 2] || ck[1] !== frame[frame.length - 1]) return { error: 'checksum' };
    const addr = frame[3];
    return {
      addr,
      source: XIAOMI_REPLY[addr] ?? null,
      dest: Object.keys(XIAOMI_ADDR).find((k) => XIAOMI_ADDR[k] === addr) ?? null,
      cmd: frame[4],
      reg: frame[5],
      payload: frame.slice(6, 6 + len - 2),
    };
  },
};

export const Ninebot = {
  name: 'ninebot',
  header: [0x5a, 0xa5],

  encode({ target, cmd, reg, payload = [], src = NINEBOT_APP_ADDR }) {
    const body = [payload.length, src, NINEBOT_ADDR[target], cmd, reg, ...payload];
    return u8([0x5a, 0xa5, ...body, ...checksum(body)]);
  },

  encodeReply({ target, reg, payload, cmd = CMD.NINEBOT_READ_REPLY }) {
    const body = [payload.length, NINEBOT_ADDR[target], NINEBOT_APP_ADDR, cmd, reg, ...payload];
    return u8([0x5a, 0xa5, ...body, ...checksum(body)]);
  },

  read(target, reg, length) {
    return this.encode({ target, cmd: CMD.READ, reg, payload: [length] });
  },

  write(target, reg, value16) {
    return this.encode({ target, cmd: CMD.NINEBOT_WRITE, reg, payload: [value16 & 0xff, (value16 >> 8) & 0xff] });
  },

  frameLength(buf, i) {
    if (buf.length < i + 3) return null;
    return buf[i + 2] + 2 /*hdr*/ + 1 /*len*/ + 4 /*src dst cmd reg*/ + 2 /*ck*/;
  },

  decodeFrame(frame) {
    const len = frame[2];
    const body = Array.from(frame.slice(2, 2 + 5 + len));
    const ck = checksum(body);
    if (ck[0] !== frame[frame.length - 2] || ck[1] !== frame[frame.length - 1]) return { error: 'checksum' };
    const src = frame[3];
    const dst = frame[4];
    return {
      src,
      dst,
      source: src === NINEBOT_APP_ADDR ? null : NINEBOT_REPLY[src] ?? null,
      dest: Object.keys(NINEBOT_ADDR).find((k) => NINEBOT_ADDR[k] === dst) ?? null,
      cmd: frame[5],
      reg: frame[6],
      payload: frame.slice(7, 7 + len),
    };
  },
};

export const PROTOCOLS = { xiaomi: Xiaomi, ninebot: Ninebot };

// Sammelt BLE-Notifications (die Frames können zerstückelt ankommen)
// und liefert vollständige, geprüfte Frames.
export class FrameParser {
  constructor(protocol) {
    this.protocol = protocol;
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out = [];
    const [h0, h1] = this.protocol.header;
    let i = 0;
    while (i < this.buf.length - 1) {
      if (this.buf[i] !== h0 || this.buf[i + 1] !== h1) {
        i++;
        continue;
      }
      const flen = this.protocol.frameLength(this.buf, i);
      if (flen === null || i + flen > this.buf.length) break; // auf weitere Daten warten
      const frame = this.buf.slice(i, i + flen);
      const decoded = this.protocol.decodeFrame(frame);
      if (decoded.error) {
        i++; // falscher Header-Treffer, weitersuchen
        continue;
      }
      out.push({ ...decoded, raw: frame });
      i += flen;
    }
    this.buf = this.buf.slice(i);
    if (this.buf.length > 512) this.buf = this.buf.slice(-64); // Müll begrenzen
    return out;
  }
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function readU16(p, off) {
  return p[off] | (p[off + 1] << 8);
}

export function readS16(p, off) {
  const v = readU16(p, off);
  return v & 0x8000 ? v - 0x10000 : v;
}

export function readU32(p, off) {
  return (readU16(p, off) + readU16(p, off + 2) * 0x10000) >>> 0;
}
