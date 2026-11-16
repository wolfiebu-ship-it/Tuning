# ScooterTune

Web-App (PWA) zum Auslesen und Einstellen von **Xiaomi Mi** und **Segway-Ninebot** E-Scootern per Bluetooth.
Sie läuft direkt im Browser, ohne Installation und ohne Build-Schritt.

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Cockpit** | Live-Tempo, Akkustand, Fahrt-/Gesamtkilometer, Ø-Tempo, Temperatur, Seriennummer, ESC/BMS-Firmware, Fehlercode |
| **Tuning** | Rekuperation (KERS schwach/mittel/stark), Tempomat, Rücklicht dauerhaft an, Wegfahrsperre, Fahrprofile (Reichweite, Komfort, Stadt), Anleitung zur Custom Firmware |
| **Akku** | Spannung, Strom, Leistung, Restkapazität, Temperaturen, alle 10 Zellspannungen mit Balance-Bewertung |
| **Experte** | Beliebige ESC/BMS-Register lesen und schreiben, Protokoll-Log (Hex) |
| **Demo-Modus** | Simulierter Roller zum Ausprobieren ohne Hardware |

## Starten

```bash
npm start            # oder: python3 -m http.server 8080
# dann http://localhost:8080 in Chrome/Edge öffnen
```

Web Bluetooth braucht **HTTPS** oder `localhost`. Zum Nutzen am Handy die Dateien auf einen HTTPS-Host legen
(z. B. GitHub Pages) und in **Chrome für Android** öffnen. Über „Zum Startbildschirm hinzufügen“ wird es eine App.
Auf dem iPhone kann Safari kein Web Bluetooth. Dort geht es mit dem Browser **Bluefy**.

## Unterstützte Roller

- **Xiaomi:** M365, Pro, Pro 2, 1S, Essential/Lite, Mi 3
- **Segway-Ninebot:** ES1/ES2/ES4, Max G30/G30D, F-Serie, E-Serie

**Wichtig: Verschlüsselung.** Neuere BLE-Firmware verschlüsselt die Verbindung (Xiaomi ab BLE 0.90,
Ninebot je nach Modell ab BLE 1.4.x bzw. 5.7.x, Xiaomi 4 und Ninebot G2 immer). Diese App spricht das
**unverschlüsselte** Protokoll. Bei verschlüsselter Firmware ist zuerst ein BLE-Downgrade nötig
(z. B. mit der App „ScooterHacking Utility“ oder per ST-Link).

## Mehr Tempo und Leistung

Die Original-Firmware erlaubt **keine** Änderung des Tempolimits per Bluetooth. Höchstgeschwindigkeit,
Motorstrom und Anfahrverhalten änderst du mit einer Custom Firmware von
[scooterhacking.org](https://scooterhacking.org). Flashen geht z. B. mit „ScooterHacking Utility“ oder „XiaoDash“.
Danach kannst du den Roller mit ScooterTune weiter auslesen und einstellen.

> ⚠️ **Rechtlicher Hinweis:** In Deutschland sind E-Scooter laut eKFV auf 20 km/h begrenzt. Mit einem
> getunten Roller erlöschen Betriebserlaubnis und Versicherungsschutz. Fahr ihn nur auf Privatgelände.
> Nutzung auf eigene Gefahr.

## Aufbau

```
index.html            Oberfläche
css/style.css         Design (dunkel, mobil optimiert)
js/protocol.js        Rahmenformat Xiaomi (55 AA) und Ninebot (5A A5), Prüfsumme, Stream-Parser
js/registers.js       Register-Map und Dekodierung (ESC/BMS)
js/session.js         Anfrage/Antwort-Zuordnung, Warteschlange, Timeouts
js/ble.js             Web-Bluetooth-Transport (Nordic UART Service)
js/demo.js            Simulierter Roller für Demo-Modus und Tests
js/models.js          Modellliste mit Hinweisen zu Verschlüsselung und Custom Firmware
sw.js                 Offline-Cache
test/                 Tests (npm test, Node ≥ 18)
```
