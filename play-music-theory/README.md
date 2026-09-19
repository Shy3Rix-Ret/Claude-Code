# play_music_theory

Ein visuelles Instrument. Man zeichnet auf ein Raster, und was man zeichnet,
klingt: waagerecht ist Zeit, senkrecht die Tonhöhe. Ein Bogen wird eine
Melodie, ein senkrechter Strich ein Akkord, ein waagerechter ein gehaltener
Ton.

Gebaut nach dem beigelegten Executive Summary zu `play_music_theory` von
Tala Rae Schlossberg — nicht als Kopie, sondern als das, was dort beschrieben
wird. Die Punkte, die das Dokument unter **Schwächen** und **Barrierefreiheit**
auflistet, sind hier die Anforderungsliste.

---

## Starten

```
node tools/serve.mjs      # → http://localhost:4300/
```

ES-Module brauchen einen echten Origin; per `file://` verweigert jeder Browser
den Import, und ohne Origin gäbe es auch keinen Service Worker.

Keine Abhängigkeiten, kein Build-Schritt, kein `npm install`. Jeder Ton, jede
Textur und jedes Icon entsteht im Code — die App lädt zur Laufzeit nichts nach
und stellt keine einzige Netzwerkanfrage.

## Was die Vorlage vermisst — und was hier drin ist

Das Dokument ist an den Stellen am nützlichsten, an denen es kritisch wird:

| Aus dem Dokument | Hier |
|---|---|
| „Keine (oder nur gerade eingeführte) Undo-/Redo-Funktionen" | Vollständige History über 120 Schritte, `Strg+Z` / `Strg+⇧+Z`, auch für Radieren und Leeren |
| „Nur wenige Pinselgrößen und Farboptionen" | Drei Strichstärken, druckempfindlich (Stift, sonst aus der Zeichengeschwindigkeit), dazu Stift / Gerade / Radierer |
| „Man kann noch nicht die Tonart oder das genaue Tempo während der Performance ändern" | Beides läuft live. Das Tempo verankert sich phasenrichtig neu, die Schleife springt nicht |
| „Ein iPad-Modus (Vollbild) wäre wünschenswert" | Layout ab 900 px als Seitenleiste, darunter als Blatt am unteren Rand; installierbar als PWA im Vollbild |
| „Apple listet keine besonderen Accessibility-Features … keine Sprachführung" | Das Raster ist mit den Pfeiltasten vollständig bedienbar, jede Zelle sagt ihren Ton an, Kontrastmodus, `prefers-reduced-motion` |
| „Nur iOS (kein Android)" | Web-App, also überall; über das Manifest auf Android installierbar |
| „Für dauerhafte Offline-Nutzung ist die Web-App nicht vorgesehen" | Service Worker, nach dem ersten Besuch komplett offline |
| „Export als WAV- oder MIDI-Datei ist möglich" | Beides, dazu PNG und ein Projektformat zum Weiterarbeiten |

Und was das Dokument als Stärke nennt, bleibt Stärke: kein Konto, keine
Datenerhebung, kein Server. Die Zeichnung liegt im `localStorage` dieses
Browsers und sonst nirgends.

## Bedienung

| | |
|---|---|
| Zeichnen | Maus, Finger oder Stift. Zwei Finger zoomen und schieben |
| Leertaste | Abspielen / Anhalten |
| `1` – `4` | Stift wählen (SoftKeys, Marimba, Warm Synth, Glocken) |
| `B` / `L` / `E` | Stift · Gerade · Radierer |
| `◀ ▶ ▲ ▼` | Cursor im Raster; `Eingabe` setzt einen Ton |
| `⇧ + ◀ ▶` | Zuletzt gesetzten Ton verlängern oder kürzen |
| `Alt` + Pfeil | Ganzer Schlag bzw. ganze Oktave |
| `Strg + Z` | Rückgängig |
| `T` / `[` `]` | Tempo klopfen · ± 2 BPM |
| `M` / `R` | Metronom · an den Anfang |
| `+` `−` `0` | Zoom |
| `?` | Alle Kürzel |

Ohne Maus ist die App vollständig bedienbar: Pfeiltasten bewegen einen
Cursor durch das Raster, und eine Live-Region liest jede Zelle als Ton, Takt
und Schlag vor.

## Aufbau

```
index.html            Seitengerüst, Dialoge, Fehler-Trap vor dem Modul
styles/app.css        Oberfläche, Farben, beide Layouts
manifest.webmanifest  Installation auf Telefon und Desktop
sw.js                 Offline-Speicher
src/
  config.js           Stifte, Raster, Grenzwerte — jede Stellschraube
  theory.js           Skalen, Tonnamen, die Tonleiter des Rasters
  state.js            der eine Zustand, Undo/Redo, Serialisierung
  strokes.js          Linie → Note. Der Kern der ganzen App
  paper.js            Canvas in drei Ebenen, Zoom, Koordinaten
  pointer.js          Maus, Finger, Stift, Zwei-Finger-Gesten
  keyboard.js         Kürzel und der Zeichenmodus ohne Maus
  sequencer.js        Lookahead-Uhr, Swing, Tempo im Lauf
  ui.js               DOM-Aufbau und Abgleich mit dem Zustand
  gallery.js          sechs Beispiele als Generatoren
  storage.js          localStorage und Projektdateien
  midiin.js           Web MIDI, optional in jeder Hinsicht
  main.js             Verdrahtung
  audio/
    voices.js         die vier Instrumente, komplett synthetisiert
    engine.js         Signalweg, Hall, Stimmenbegrenzung
    render.js         Offline-Rendering für den Export
  export/
    wav.js            WAV-Kodierung
    midi.js           Standard MIDI File, Format 1
tools/serve.mjs       Entwicklungsserver
```

## Wie aus einer Linie Musik wird

Ein Strich ist eine Polylinie in musikalischen Koordinaten: `t` in Schlägen,
`y` als Höhe von 0 bis 1. Bewusst weder in Pixeln noch in Rasterzellen —
daraus folgen die zwei Eigenschaften, die das Instrument ausmachen:

- **`t` in Schlägen.** Die Quantisierung darf sich ändern, ohne die Zeichnung
  anzufassen. Das Raster ist immer genau so fein wie das, was man hört.
- **`y` normalisiert.** Wer die Skala wechselt, behält exakt dieselbe Form und
  bekommt dieselbe Melodie in der neuen Tonart. Dur-Pentatonik auf Blues
  umstellen und einmal abspielen — das ist der Moment, in dem die App klick
  macht.

Zum Abspielen wird jeder Strich in Rasterzellen abgetastet, und zusammen­
hängende Zellen derselben Zeile verschmelzen zu **einer** Note. Ein naives
„ein Punkt = eine Note" bekommt genau das nie hin:

- waagerechter Strich → ein gehaltener Ton statt zwanzig Wiederholungen
- senkrechter Strich → ein Akkord aus allen berührten Zeilen
- schräge Linie → ein Lauf durch die Skala

Swing wird erst beim Abspielen aufgerechnet, nicht beim Zeichnen. So bleibt das
Raster ehrlich, und man kann Swing drehen, während die Schleife läuft.

## Klang

Vier Instrumente, kein einziges Sample:

- **SoftKeys** — 2:1-FM mit schnell fallendem Index. Das ist im Kern ein
  Rhodes: glockiger Anschlag, der sofort in einen weichen Ton übergeht.
- **Marimba** — Teiltöne bei 1 : 3,93 : 9,6, also inharmonisch wie ein
  Holzstab, plus ein gefilterter Rauschimpuls als Schlägel. Hohe Töne klingen
  kürzer aus als tiefe.
- **Warm Synth** — zwei verstimmte Sägezähne durch ein Filter mit eigener
  Hüllkurve, ein Sub darunter, eine langsame Schwebung darüber.
- **Glocken** — FM mit 3,51 : 1. Krumm ist der Punkt: ganze Zahlen klingen
  nach Orgel, krumme nach Metall.

Der Hall ist eine im Code erzeugte Impulsantwort. Eine geladene `.wav` wäre
besser und würde genau das kaputtmachen, was die App ausmacht.

Der WAV-Export rendert offline mit demselben Stimmen-Code und demselben
Signalweg: was man exportiert, ist was man gehört hat. Deshalb kein
`MediaRecorder` — der nimmt in Echtzeit auf, liefert je nach Browser webm
statt wav und hängt am Ausgabegerät.

## Warum ein Lookahead-Scheduler

`setInterval` ist für Musik unbrauchbar: Browser verzögern Timer um zig
Millisekunden, und das hört man sofort. Stattdessen sieht ein grober Timer
alle 25 ms nach, welche Noten in den nächsten 140 ms fällig sind, und plant sie
mit exakten Zeitstempeln in die Audio-Hardware. Die Darstellung liest ihre
Position danach aus der Audio-Uhr, nicht aus einem Frame-Zähler — sonst
driftet der Abspielkopf gegen den Ton.

## Auf dem Telefon

- Das Blatt bekommt den ganzen Platz, die Werkzeuge liegen unten beim Daumen.
- Alles Weitere steckt in einem Blatt, das man hochzieht.
- `touch-action: none` auf dem Canvas, `overscroll-behavior: none` auf dem
  Body: kein Pull-to-Refresh mitten im Strich.
- Safe-Area-Insets für die Notch, `dvh` statt `vh` gegen die einklappende
  Adressleiste.
- Pro Bild wird nur das neu gezeichnet, was sich geändert hat — Raster und
  fertige Striche liegen auf eigenen Ebenen. Das ist der Unterschied zwischen
  flüssig und zäh, sobald ein paar hundert Striche auf dem Blatt sind.

## Wenn etwas nicht startet

Eine App, die man als Link weitergibt, landet auf Geräten, an die kein Debugger
kommt. Fehler landen deshalb sichtbar auf dem Ladebildschirm statt in einer
Konsole, die niemand öffnet:

- Ein Fehler-Trap läuft **vor** dem Modul und fängt auch einen Parse-Fehler ab.
- Ton, MIDI und Service Worker dürfen einzeln fehlschlagen, ohne den Start
  aufzuhalten. `AudioContext.resume()` bekommt eine Frist statt eines offenen
  `await` — iOS lehnt im iframe nicht ab, sondern lässt das Promise ewig offen,
  und ein Start, der darauf wartet, kommt nie zurück.
- Kein `localStorage` (privates Fenster, volles Kontingent): die App läuft
  weiter, sie merkt sich nur nichts.

## Grenzen

- Die Strichstärke bestimmt Optik und Lautstärke, nicht die Anzahl getroffener
  Töne. Ein dicker Strich trifft dieselben Zeilen wie ein dünner. Das ist eine
  Entscheidung für Vorhersagbarkeit.
- Web MIDI fehlt in Safari und Firefox. Die App merkt das und sagt es, statt
  einen toten Knopf anzubieten.
- Ab etwa 900 Strichen wird auch ein schnelles Gerät träge; die Anzeige färbt
  sich vorher ein.
