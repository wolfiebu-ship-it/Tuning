// Register-Map (16-Bit-Wörter). Register-Nr. = Wortadresse; Byte-Offset innerhalb
// einer Leseantwort = (reg - startReg) * 2.
import { readU16, readS16, readU32 } from './protocol.js';

export const REG = {
  // ESC
  SERIAL: 0x10, // 14 Byte ASCII
  ESC_VERSION: 0x1a,
  ERROR: 0x1b,
  LOCK: 0x70, // 1 schreiben = sperren
  UNLOCK: 0x71, // 1 schreiben = entsperren
  KERS: 0x7b, // 0 schwach, 1 mittel, 2 stark
  CRUISE: 0x7c, // 0 aus, 1 an
  TAILLIGHT: 0x7d, // 0 aus, 2 immer an
  LIVE: 0xb0, // Block mit Live-Daten (0x20 Byte)
  // BMS
  BMS_VERSION: 0x17,
  BMS_STATUS: 0x31, // Restkapazität, %, Strom, Spannung, Temp
  BMS_CELLS: 0x40, // 10 Zellspannungen in mV
};

export const READS = {
  info: [
    { target: 'esc', reg: REG.SERIAL, len: 14 },
    { target: 'esc', reg: REG.ESC_VERSION, len: 4 },
    { target: 'bms', reg: REG.BMS_VERSION, len: 2 },
  ],
  live: [{ target: 'esc', reg: REG.LIVE, len: 0x20 }],
  settings: [{ target: 'esc', reg: REG.KERS, len: 6 }],
  battery: [
    { target: 'bms', reg: REG.BMS_STATUS, len: 10 },
    { target: 'bms', reg: REG.BMS_CELLS, len: 20 },
  ],
};

export function formatVersion(v) {
  // 0x0134 -> "1.3.4"
  const hex = v.toString(16).padStart(3, '0');
  return hex.split('').join('.').replace(/^0\./, '');
}

// Wandelt eine Antwort in Teilzustände um, die in den App-Zustand gemerged werden.
export function decodeReply(source, reg, p) {
  if (source === 'esc') {
    switch (reg) {
      case REG.SERIAL:
        return { info: { serial: String.fromCharCode(...p).replace(/\0/g, '').trim() } };
      case REG.ESC_VERSION:
        return {
          info: {
            escVersion: formatVersion(readU16(p, 0)),
            ...(p.length >= 4 ? { errorCode: readU16(p, 2) } : {}),
          },
        };
      case REG.KERS:
        return {
          settings: {
            kers: readU16(p, 0),
            ...(p.length >= 4 ? { cruise: readU16(p, 2) === 1 } : {}),
            ...(p.length >= 6 ? { taillight: readU16(p, 4) === 2 } : {}),
          },
        };
      case REG.LIVE:
        if (p.length < 24) return null;
        return {
          live: {
            error: readU16(p, 0),
            warning: readU16(p, 2),
            locked: (readU16(p, 4) & 0x02) !== 0,
            battery: readU16(p, 8),
            speed: readS16(p, 10) / 1000,
            avgSpeed: readU16(p, 12) / 1000,
            totalKm: readU32(p, 14) / 1000,
            tripKm: readU16(p, 18) / 100,
            uptime: readU16(p, 20),
            temperature: readS16(p, 22) / 10,
          },
        };
    }
  }
  if (source === 'bms') {
    switch (reg) {
      case REG.BMS_VERSION:
        return { info: { bmsVersion: formatVersion(readU16(p, 0)) } };
      case REG.BMS_STATUS:
        if (p.length < 10) return null;
        return {
          battery: {
            capacity: readU16(p, 0),
            percent: readU16(p, 2),
            current: readS16(p, 4) / 100,
            voltage: readU16(p, 6) / 100,
            temps: [p[8] - 20, p[9] - 20],
          },
        };
      case REG.BMS_CELLS: {
        const cells = [];
        for (let i = 0; i + 1 < p.length; i += 2) {
          const mv = readU16(p, i);
          if (mv > 0) cells.push(mv / 1000);
        }
        return { battery: { cells } };
      }
    }
  }
  return null;
}
