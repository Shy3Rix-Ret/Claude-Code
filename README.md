# LEVEL 4444 — THE ABYSS

Ein atmosphärisches Horror-Erlebnis in Three.js. Kein Ziel, kein Punktestand,
kein Scheitern. Etwa 15 Minuten offenes Wasser, eine Tür, und ein Ortswechsel.

Umgesetzt nach dem Design- und Regiedokument, Sektion für Sektion. Verweise wie
`§3.2` im Code zeigen auf die jeweilige Stelle im Dokument.

---

## Starten

**Am schnellsten:** `dist/level-4444.html` im Browser öffnen. Eine einzige
Datei, komplett offline, keine einzige Netzwerkanfrage — funktioniert auch per
Doppelklick vom Dateisystem.

**Für die Entwicklung** (ES-Module brauchen einen echten Origin):

```
node tools/serve.mjs      # → http://localhost:4444/
```

**Neu bauen:**

```
npm install --no-save esbuild
node tools/build.mjs
```

Erzeugt zwei Dateien:

- `dist/level-4444.html` — vollständiges Dokument, zum direkten Öffnen.
- `dist/level-4444.embed.html` — nur der Body-Inhalt, für Hosts, die
  `<html>`/`<head>`/`<body>` selbst mitbringen (claude.ai-Artifacts, CMS,
  iframes). Identischer Bundle; das Viewport-Meta wird zur Laufzeit gesetzt
  und der schwarze Grund in beiden Farbschemata erzwungen, weil sonst der
  Host darüber entscheidet.

Ein Hinweis zu Vorschau-Ansichten: viele In-App-Dateibetrachter zeigen HTML
und CSS an, führen aber kein JavaScript aus. Man sieht dann nur die
Ladezeile und sonst nichts. Das ist keine kaputte Datei — die Seite gehört
in einen echten Browser.

Im iframe (also auch im Artifact) ist das Gyroskop in der Regel gesperrt;
die Steuerung fällt sauber auf Ziehen zurück. Für die volle Fassung
inklusive Neigungssteuerung die Datei direkt im Browser öffnen.

Three.js liegt unter `vendor/` im Repo. Es gibt keine Laufzeit-Abhängigkeiten
und keine Assets: jede Textur, jeder Ton und jedes Modell entsteht beim Start
prozedural im Code.

## Steuerung (§6)

| | |
|---|---|
| Ziehen / Maus | Blickrichtung |
| Tippen und halten | vorwärts schwimmen |
| Loslassen | stillhalten — **in Akt 3 ist das die Mechanik** |

Am Handy zusätzlich Gyroskop, falls das Gerät es erlaubt (die Abfrage passiert
beim ersten Tippen, zusammen mit der Audio-Freigabe). Am PC: Maus für den
Blick, `W` / Leertaste / linke Maustaste zum Schwimmen.

Kein HUD, keine Buttons, kein Pausemenü. **Kopfhörer werden dringend
empfohlen** — ein großer Teil des Sounddesigns liegt unter dem, was ein
Handylautsprecher überhaupt wiedergeben kann (§3.4).

## Aufbau

```
index.html          Seitengerüst, die drei Textmomente, CSS
vendor/             Three.js (eingecheckt, damit nichts nachgeladen wird)
src/
  config.js         Palette, Timings, Wellen, jede Stellschraube an einem Ort
  state.js          der eine veränderliche Weltzustand
  director.js       Uhr, Akte, Cutscene — entscheidet als Einziges, was passiert
  main.js           Bootstrap, Frame-Loop, Kamera
  controls.js       Blick, Schwimmen, Stillhalten
  ocean.js          Wasseroberfläche (Custom Shader, Polar-Grid)
  sky.js            Nebelkuppel
  glsl.js           gemeinsames GLSL, Wellenfeld-Codegen
  watchers.js       die Beobachter + das kurze Aufblitzen im Establishing Shot
  abyss.js          Schwebeteilchen und das große Ding in der Tiefe
  door.js           der Lichtpunkt, die Tür, das Licht darunter
  hand.js           die First-Person-Hand aus Akt 5
  materials.js      gemeinsames Oberflächen-Material, prozedurale Texturen
  post.js           Bloom, Vignette, Filmkorn, Aberration, Linsentropfen
  audio.js          das komplette Sounddesign, in Echtzeit synthetisiert
  overlay.js        die einzigen drei Texteinblendungen
tools/serve.mjs     Mini-Server für die Entwicklung
tools/build.mjs     Single-File-Build
```

## Ablauf

| Phase | Dauer | |
|---|---|---|
| Cold Open | 0:15 | schwarz, nur Ton, dann 1,5 s absolute Stille (§2.1) |
| Erwachen | 0:30 | Aufblende in drei Stufen, Atem beruhigt sich (§2.2) |
| Establishing Shot | 0:30 | 180°-Schwenk ohne Input, endet auf dem Licht (§2.3) |
| Akt 1 — Das Treiben | ~3:30 | Leere. Beobachter weit weg, verschwinden bei Blickkontakt |
| Akt 2 — Die Präsenz | ~3:45 | sie kommen näher, das Licht kehrt zurück |
| Akt 3 — Der Sog | 2:00+ | alle verschwinden gleichzeitig, das Wasser wird bodenlos |
| Akt 4 — Der Weg zum Licht | ~3:30 | hinschwimmen, ohne direkt hinzusehen |
| Akt 5 — Die Tür | ~1:10 | Hand am Griff, Schnitt auf Schwarz, `LEVEL 2` |

Gesamt etwa 15–16 Minuten.

## Wie die drei Kernideen technisch funktionieren

**Peripheres Sehen (§3.2).** Jeder Beobachter wird pro Frame in den Bildraum
projiziert; sein Abstand zur Bildmitte ergibt einen Wert `edge`. Am Bildrand ist
`edge = 1`: die Augen leuchten am hellsten und speisen das Bloom. Landet er in
der Mitte, läuft ein Timer (`gazeTolerance`, 0,55 s) — danach sinkt er in 0,4
Sekunden weg. Kurz genug, dass man sich nie sicher ist. Sie erscheinen außerdem
nur in Winkeln, in die man gerade nicht schaut.

**Der Stillhalte-Moment (§4, Akt 3).** Kein Fail-State, aber die Anspannung ist
echt. Ruhe wird als Guthaben angespart (`STILL_REQUIRED`, 46 s); jede Berührung
gibt davon etwas zurück und erhöht `agitation`, was Herzschlag, Kamerazittern,
Chromatic Aberration und Filmkorn hochzieht. Die Erkennung ist bewusst
großzügig (~12°/s Toleranz), damit eine ruhig gehaltene Hand nicht als Ungehorsam
gilt. Nach `ACT3_HARD_CAP` löst sich die Szene in jedem Fall auf — der Moment
läuft narrativ immer glimpflich ab, aber nichts im Bild oder Ton sagt das.

**Regel 1 als Führung, nicht als Zwang (§4, Akt 4).** Wer den Lichtpunkt direkt
anstarrt, bekommt keinen Game Over, sondern dichteren Nebel, weniger Belichtung,
Entsättigung und langsameres Schwimmen. Bleibt er im Randbereich, öffnet sich
alles wieder. Die Strömung trägt einen ohnehin zur Tür — das Level endet immer.

## Eine bewusste Abweichung vom Dokument

§2.2/§2.3 lassen den fernen Lichtpunkt schon im Prolog erscheinen und am Ende
des Schwenks im Bild stehen; §4 lässt ihn „zum ersten Mal" in Akt 2 auftauchen.
Beides ist umgesetzt: man erhascht ihn im Prolog, in Akt 1 verschwindet er
vollständig, in Akt 2 kommt er zurück und bleibt. Damit wird das Licht zur
selben Frage wie die Beobachter — *habe ich das gesehen oder nicht* — angewendet
auf das einzige Element im Bild, dem man vertrauen möchte.

## Performance

Beim Start wird eine Qualitätsstufe (`high` / `medium` / `low`) anhand von
Kernen, Speicher und Displaygröße gewählt; sie steuert Wasser-Tessellation,
Bloom-Auflösung, Partikeldichte und Pixel-Ratio-Deckel. Fällt die Bildrate unter
24 fps, wird zuerst die Renderauflösung gesenkt und nichts anderes angetastet —
Detailgrad vor Auflösung, so wie in §5 vorgesehen.

Der Post-Stack ist von Hand geschrieben statt über `EffectComposer`: Aberration,
Bewegungsunschärfe, Linsentropfen, Unterwasser-Verzerrung, Tonemapping,
Vignette und Korn laufen in *einem* Fragment-Shader in voller Auflösung. Das
gesparte Fill-Rate-Budget steckt im Wasser-Shader.

## Entwickler-Abkürzungen

Nicht im Spiel sichtbar, nur über URL oder Tastatur:

```
?act=1 … ?act=5     direkt in einen Akt springen
?speed=8            Zeitraffer
Shift+1 … Shift+5   Akt wechseln
Shift+Plus/Minus    Zeit schneller / langsamer
```
