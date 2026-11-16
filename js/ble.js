// Bluetooth-Transport (Nordic UART Service, wird von Xiaomi und Ninebot genutzt)
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // App -> Roller
const NUS_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Roller -> App
// Xiaomi-Auth-Service: ist er vorhanden, ist die Verbindung verschlüsselt.
const MI_AUTH_SERVICE = 0xfe95;

export function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export function guessBrand(deviceName = '') {
  const n = deviceName.toLowerCase();
  if (n.startsWith('miscooter') || n.startsWith('mi ')) return 'xiaomi';
  if (n.startsWith('nbscooter') || n.includes('ninebot') || n.startsWith('segway')) return 'ninebot';
  return null;
}

export class BleTransport {
  constructor() {
    this.device = null;
    this.tx = null;
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.name = '';
    this.encryptedHint = false;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MIScooter' }, { namePrefix: 'NBScooter' }, { services: [NUS_SERVICE] }],
      optionalServices: [NUS_SERVICE, MI_AUTH_SERVICE],
    });
    this.name = this.device.name || 'Unbekannter Roller';
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect());
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.tx = await service.getCharacteristic(NUS_TX);
    const rx = await service.getCharacteristic(NUS_RX);
    rx.addEventListener('characteristicvaluechanged', (e) => {
      const v = e.target.value;
      this.onData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    });
    await rx.startNotifications();
    try {
      await server.getPrimaryService(MI_AUTH_SERVICE);
      this.encryptedHint = true;
    } catch {
      this.encryptedHint = false;
    }
  }

  async write(bytes) {
    // BLE-Pakete auf 20 Byte begrenzen (Standard-MTU)
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
      else await this.tx.writeValue(chunk);
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
