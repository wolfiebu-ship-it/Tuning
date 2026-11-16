// Unterstützte Modelle. "stockLimit" = Werkslimit (DE-Version), "cfw" = Custom
// Firmware von ScooterHacking verfügbar, "encrypted" = neuere BLE-Firmware
// verschlüsselt die Verbindung (dann vorher BLE-Downgrade nötig).
export const MODELS = [
  { id: 'm365', brand: 'xiaomi', name: 'Xiaomi Mi M365', stockLimit: 20, cfw: true, encrypted: 'ab BLE 0.90' },
  { id: 'pro', brand: 'xiaomi', name: 'Xiaomi Mi Pro', stockLimit: 20, cfw: true, encrypted: 'ab BLE 0.90' },
  { id: 'pro2', brand: 'xiaomi', name: 'Xiaomi Mi Pro 2', stockLimit: 20, cfw: true, encrypted: 'ab BLE 0.90' },
  { id: '1s', brand: 'xiaomi', name: 'Xiaomi Mi 1S', stockLimit: 20, cfw: true, encrypted: 'ab BLE 0.90' },
  { id: 'lite', brand: 'xiaomi', name: 'Xiaomi Mi Essential / Lite', stockLimit: 20, cfw: true, encrypted: 'ab BLE 0.90' },
  { id: 'mi3', brand: 'xiaomi', name: 'Xiaomi Mi 3', stockLimit: 20, cfw: true, encrypted: 'immer' },
  { id: 'mi4', brand: 'xiaomi', name: 'Xiaomi 4 / 4 Pro', stockLimit: 20, cfw: false, encrypted: 'immer' },
  { id: 'es', brand: 'ninebot', name: 'Ninebot ES1 / ES2 / ES4', stockLimit: 20, cfw: true, encrypted: 'ab BLE 1.4.x' },
  { id: 'g30', brand: 'ninebot', name: 'Ninebot Max G30 / G30D', stockLimit: 20, cfw: true, encrypted: 'ab BLE 5.7.x' },
  { id: 'g30d2', brand: 'ninebot', name: 'Ninebot Max G30D II', stockLimit: 20, cfw: true, encrypted: 'ab Werk' },
  { id: 'f', brand: 'ninebot', name: 'Ninebot F20 / F25 / F30 / F40', stockLimit: 20, cfw: true, encrypted: 'ab BLE 5.x' },
  { id: 'e', brand: 'ninebot', name: 'Ninebot E22 / E25 / E45', stockLimit: 20, cfw: true, encrypted: 'ab BLE 1.4.x' },
  { id: 'g2', brand: 'ninebot', name: 'Ninebot Max G2 / G65', stockLimit: 20, cfw: false, encrypted: 'immer' },
];

export function modelsFor(brand) {
  return MODELS.filter((m) => m.brand === brand);
}
