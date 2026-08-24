# KIOSK IMPERIUM

Ein Wirtschaftssimulator im Browser. Ein Kiosk im Bahnhofsviertel, zwei
Aushilfen, 25.000 € — am Ende steht der Börsengang bei 2,5 Mio. € Firmenwert
oder die Insolvenz. Kein Framework, keine Assets, keine Netzwerkanfrage.

---

## Starten

**Am schnellsten:** `dist/kiosk-imperium.html` im Browser öffnen. Eine Datei,
komplett offline, funktioniert per Doppelklick vom Dateisystem.

**Für die Entwicklung** (ES-Module brauchen einen echten Origin):

```
node tools/serve.mjs        # → http://localhost:4444/tycoon/
```

**Neu bauen:**

```
npm install --no-save esbuild
node tools/build-tycoon.mjs
```

Erzeugt `dist/kiosk-imperium.html` (vollständiges Dokument) und
`dist/kiosk-imperium.embed.html` (nur Body-Inhalt, für Hosts, die
`<html>`/`<head>`/`<body>` selbst mitbringen).

## Steuerung

| | |
|---|---|
| Leertaste | Pause an/aus |
| `1` `2` `3` | Tempo: 2,4 s / 1,1 s / 0,45 s pro Spieltag |
| Klick | alles andere |

Der Spielstand liegt in `localStorage` und wird alle zehn Tage, beim
Tab-Wechsel und beim Schließen gesichert.

## Wie das Spiel rechnet

Ein Tick ist ein Geschäftstag. Für jede Filiale läuft dieselbe Kette:

**1. Laufkundschaft.** Grundwert des Viertels × Jahreszeit × Wochentag ×
Ausbauten × Werbereichweite × Ruf × (1 − Konkurrenzdruck), plus Tagesrauschen.
Der Ruf ist dabei kein Schmuck: bei 100 kommen rund 40 % mehr Gäste als bei 50,
bei 0 nur zwei Drittel.

**2. Nachfrage je Kategorie.** Produkte konkurrieren nur innerhalb ihrer
Kategorie (Hauptgericht, Beilage, Getränk, Süßes). Die Kategorie schöpft
`take × (1 − e^−A)` der Laufkundschaft ab, wobei `A` die Summe der
Attraktivitäten ist — ein zweites Getränk bringt also deutlich weniger als das
erste, und ein breiteres Sortiment hilft mit abnehmendem Ertrag.

**3. Attraktivität.** `Grundreiz × Qualität × Preisfaktor`, dazu Trend- und
Saisonfaktoren. Der Preisfaktor ist eine Logistikkurve um den Referenzpreis,
skaliert mit der Kaufkraft des Viertels: `2 / (1 + e^(3,2·(r−1)))`. Bei −30 %
verkaufst du etwa 45 % mehr, bei +50 % zwei Drittel weniger.

**4. Küche.** Jeder Verkauf frisst Durchsatz. Reicht das Personal nicht, wird
anteilig bedient und der Rest geht verloren — sichtbar als „verlorene Gäste“,
und der Ruf zahlt dafür.

**5. Kasse.** Umsatz − Wareneinsatz (Qualitätsstufe × Verderb × Forschung) −
Löhne − Miete − Betrieb − Werbung − Zinsen. Monatlich 25 % Steuer auf den
Gewinn. Ein negativer Kontostand wird automatisch zum Kredit; reißt der den
Rahmen um mehr als ein Drittel, ist das Spiel vorbei.

**6. Ruf.** Läuft nicht frei, sondern auf einen Zielwert zu:
`50 + (Qualität − 1)·70 + (1 − relativer Preis)·30 − verlorene Gäste·50 + Kampagnen`.
Pro Tag werden 5 % der Differenz gegangen. Eine Preiserhöhung kostet damit
einen festen Betrag an Wohlwollen statt alles.

## Balance

Die Zahlen stehen alle in `src/data.js`. Wer daran dreht, prüft die Folgen
headless — dieselbe Simulation, drei sehr unterschiedliche Hände am Steuer:

```
node tools/balance-tycoon.mjs 720 12    # Tage, Durchläufe
```

Sollergebnis (720 Tage, 12 Seeds):

| Strategie | Firmenwert | Filialen | Pleiten |
|---|---|---|---|
| Nichtstun | ≈ 60 Tsd. € | 1 | 0/12 |
| Nur Preise hoch | ≈ 27 Tsd. € | 1 | 0/12 |
| Guter Spieler | ≈ 1,6 Mio. € | 7–8 | 0/12 |

Der Börsengang fällt bei kompetentem Spiel um Tag 800. Wandern diese Zahlen
nach einer Änderung stark, stimmt die Balance nicht mehr.

## Aufbau

```
src/data.js       Alle Zahlen: Menü, Standorte, Personal, Ausbau, Forschung,
                  Kampagnen, Ereignisse, Ziele. Sonst nichts.
src/economy.js    Die Simulation. tickDay() plus alle Spielzüge als Aktionen,
                  die { ok, msg } zurückgeben.
src/ui.js         Sechs Tabs über einem Spielobjekt, Ereignis-Delegation.
src/chart.js      Der eine Chart, direkt auf Canvas.
src/save.js       Speicherstand (Sets und PRNG überleben JSON nicht von allein).
src/util.js       Formatierung, Kalender, PRNG.
src/main.js       Uhr und Verdrahtung.
```

Die Oberfläche rechnet nie selbst: sie liest, was `economy.js` in `game.today`
und in `loc.stats` hinterlassen hat.
