Zwei Stücke liegen in diesem Repo. Beide laufen auf demselben eingecheckten
Three.js unter `vendor/`, beide erzeugen jede Textur, jeden Ton und jedes Modell
zur Laufzeit im Code, und beide bauen zu einer einzigen HTML-Datei.

| | | |
|---|---|---|
| **LEVEL 4444 — THE ABYSS** | `index.html`, `src/` | Horror, 15 Minuten, auf Schienen |
| **BAHNHOF KEPLER-9** | `station.html`, `station/` | frei begehbar, kein Ende — [zur Beschreibung](#bahnhof-kepler-9) |

---

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

Im Artifact läuft das Level in einem iframe, der den Pointer-Lock oft
verweigert; die Steuerung fällt dann auf Klicken-und-Ziehen zurück. Direkt
geöffnet greift der Lock, und `F11` macht es Vollbild.

Three.js liegt unter `vendor/` im Repo. Es gibt keine Laufzeit-Abhängigkeiten
und keine Assets: jede Textur, jeder Ton und jedes Modell entsteht beim Start
prozedural im Code.

## Steuerung (§6)

Desktop, Maus und Tastatur. Es gibt keine Touch- oder Neigungssteuerung.

| | |
|---|---|
| Maus | Blickrichtung |
| `W` / `↑` / Leertaste | vorwärts schwimmen |
| Linke Maustaste | ebenfalls schwimmen, sobald der Zeiger gefangen ist |
| Loslassen | stillhalten — **in Akt 3 ist das die Mechanik** |

Die Kamera läuft über Pointer-Lock: Klick fängt den Zeiger, Umsehen braucht
kein Ziehen und hat keinen Rand. `Esc` gibt ihn frei, ein Klick holt ihn
zurück — dieser Klick schwimmt bewusst *nicht*, sonst würde jedes
Zurückholen einen nach vorn stoßen. Verweigert ein Browser den Lock (meist
in einem eingeschränkten iframe), fällt der Blick auf Klicken-und-Ziehen
zurück; die Tastatur schwimmt weiterhin.

Kein HUD, keine Buttons, kein Pausemenü. **Kopfhörer werden dringend
empfohlen** — ein großer Teil des Sounddesigns liegt unter dem, was kleine
Lautsprecher überhaupt wiedergeben (§3.4).

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
| Cold Open | 0:15 | schwarz, nur Ton, dann 1,5 s absolute Stille (§2.1). Ohne Audio auf 2,4 s verkürzt — stumm ist derselbe Bildschirm kein Cold Open, sondern eine kaputte Seite |
| Erwachen | 0:30 | Aufblende in drei Stufen, erstes schwaches Bild nach ~3 s, Atem beruhigt sich (§2.2) |
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
Beides ist umgesetzt: man erhascht ihn im Prolog, in Akt 1 dimmt er auf ein
Horizontglimmen herunter, in Akt 2 kommt er zurück und bleibt.

Ursprünglich blendete Akt 1 ihn auf null. Das war ein Fehler: der Schwenk endet
laut §2.3 genau auf dem Licht, und danach war der einzige Orientierungspunkt im
Bild schlicht weg — das liest sich nicht als Unheimlichkeit, sondern als Bug.
Jetzt bleibt er sichtbar und ist trotzdem unerreichbar, weil er jeden Frame neu
in `horizonDistance` (780 m) relativ zum Spieler verankert wird. Daraufhin
zuzuschwimmen ändert nichts — das ist §1, nicht ein defektes Ziel.

## Wenn etwas nicht startet

Das Level wird als Link weitergegeben, also muss es sich auf Geräten erklären
können, an die kein Debugger kommt. Fehler landen sichtbar auf dem
Ladebildschirm statt in einer Konsole, die niemand öffnet:

- Ein Fehler-Trap läuft **vor** dem Bundle und fängt auch einen Parse-Fehler
  im Spielcode ab.
- Ton, Gyroskop und Pointer-Lock dürfen einzeln fehlschlagen, ohne den Start
  aufzuhalten. `AudioContext.resume()` bekommt eine Frist statt eines offenen
  `await` — iOS lehnt im iframe nicht ab, sondern lässt das Promise ewig
  offen, und ein Start, der darauf wartet, kommt nie zurück.
- Nach der Aufblende liest das Level einmal ein paar Pixel zurück. Kommt kein
  Bild, sagt es das, statt schwarz zu bleiben — ein toter Renderer sieht
  sonst exakt aus wie eine Szene, die dunkel sein soll.
- Halbfloat-Puffer werden abgefragt, nicht angenommen; fehlt die Erweiterung,
  läuft der Post-Stack in 8 Bit mit abgesenkter Bloom-Schwelle.

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

---

# BAHNHOF KEPLER-9

Ein verlassener Weltraumbahnhof, den die Pflanzen übernommen haben. Eine
Abflughalle, 84 Meter lang, frei begehbar. Kein Ziel, keine Gegner, keine
Uhr — nur ein Stern, der langsam draußen vorbeizieht, und Licht, das durch
kaputte Fenster hereinfällt.

## Starten

**Am schnellsten:** `dist/kepler-9.html` im Browser öffnen. Eine einzige Datei,
keine Netzwerkanfrage, läuft per Doppelklick vom Dateisystem.

**Für die Entwicklung:**

```
node tools/serve.mjs        # → http://localhost:4444/station.html
```

**Neu bauen:**

```
npm install --no-save esbuild
npm run build:station       # → dist/kepler-9.html
```

## Steuerung

| | |
|---|---|
| Maus | umsehen (Pointer-Lock; im iframe fällt es auf Klicken-und-Ziehen zurück) |
| `W` `A` `S` `D` / Pfeile | gehen |
| `Shift` | schneller |
| Leertaste | springen — im Schwebemodus: steigen |
| `Strg` | im Schwebemodus: sinken |
| `F` | Schwerelosigkeit an/aus |
| `M` | Ton stumm |
| `H` | Hinweiszeile ein/aus |
| `R` | zurück zum Anfang |

`?quality=low|medium|high` erzwingt eine Qualitätsstufe, `?speed=8` lässt den
Stern im Zeitraffer wandern — praktisch, um den ganzen Lichtzyklus in einer
halben Minute zu sehen.

## Was hier interessant ist

**Die kaputten Fenster sind eine einzige Wahrheit.** Für jede Öffnung wird ein
Raster gewürfelt: welche Scheiben noch drin sind. Dieses Raster liegt als kleine
Maskentextur vor und wird von vier Systemen gelesen — von den Glas-Instanzen
(und damit vom Schattenwurf), vom Volumen-Shader der Lichtschächte, von den
Staubpartikeln, und von der Vegetation, die entscheidet, wo überhaupt genug
Licht ankommt. Der Fleck auf dem Boden, der Schacht in der Luft und die
Pflanzen darunter zeigen deshalb dasselbe Muster, statt sich nur zu ähneln.

**Die Lichtschächte sind echte Volumen.** Pro Öffnung wird das Fensterrechteck
entlang der Lichtrichtung extrudiert — ein schiefes Prisma, dessen Matrix von
Hand aus drei Basisvektoren gebaut wird. Der Fragment-Shader marschiert durch
dieses Prisma in seinem eigenen Koordinatensystem. Der Durchgang läuft *nach*
der Szene, in halber Auflösung, in einen eigenen Puffer, und liest die
Szenentiefe: deshalb legt sich ein Schacht um eine Säule herum, statt durch sie
hindurchzuscheinen.

**Die Hülle wird nicht simuliert, sie steht im Weg.** Es gibt genau ein
schattenwerfendes Licht. Wenn der Stern auf die blinde Seite der Station
wandert, wird die Halle dunkel, weil das Gebäude davor ist — nicht weil
irgendwo eine Zahl heruntergedreht wird. Die Wände sind dafür keine einzelnen
Quads, sondern werden um ihre Öffnungen herum zerlegt, damit die Löcher echte
Löcher sind.

**Die Pflanzen folgen dem Licht.** `growth(x, z)` bewertet jeden Punkt danach,
wie nah er an dem Stück Boden liegt, auf das eine Öffnung scheint. Die Form,
die das Grün in der Halle macht, ist die Form, die die kaputten Fenster
vorgezeichnet haben.

## Materialien

Vier Familien, alle prozedural gebacken (`station/textures.js`):

- **Metall** — lackierte Hüllenpaneele, Nähte, Nieten, abplatzende Farbe
- **Rost** — dasselbe Blech, wo der Lack verloren hat
- **Glas** — verdreckte Scheiben; auf der hohen Stufe mit echter Transmission,
  darunter als getönte transparente Fläche mit derselben Schmutzkarte
- **Pflanzen** — Blattkarten mit Alpha-Test, Moos, Rinde, Ranken

dazu Beton für den Boden und zwei Emissivmaterialien: die Notbeleuchtung, die
noch Strom hat, und das, was die Vegetation macht, sobald der Stern weg ist.

Die Blätter hängen an einem angepassten `MeshStandardMaterial`: Windbewegung im
Vertex-Shader (Phase pro Instanz aus der Instanzmatrix) und ein Gegenlichtterm
im Fragment-Shader, damit ein Blatt im Lichtschacht durchleuchtet statt zur
Silhouette zu werden.

## Ton

Vollständig synthetisiert, kein Audiofile: ein tiefer Hüllendrone, der Luftzug
durch die Fenster (sein Pegel folgt dem Lichtzyklus), gelegentliches Ächzen der
Struktur, tropfendes Wasser. Der **Ambient-Sound-Trigger** ist `Ambience.start()`
in `station/audio.js` und wird genau einmal aufgerufen: aus dem Klick, der die
Szene startet — Browser lassen Audio ohne Geste nicht zu. Wer lieber eine echte
Datei nimmt, findet dort einen kommentierten Dreizeiler dafür.

## Aufbau

```
station.html        Seitengerüst, Ladeschirm, die Texteinblendungen, CSS
station/
  config.js         Palette, Maße, Fensterraster, jede Stellschraube
  util.js           Mathe, Seed-RNG, Value-Noise
  textures.js       jede Oberfläche, beim Laden aus Rauschen gebacken
  materials.js      die vier Materialfamilien, Wind- und Gegenlicht-Shader
  openings.js       die Löcher in der Hülle und die Scheibenmaske
  station.js        Halle, Gates, Mezzanin, Fenster, Inventar, Trümmer
  flora.js          Ranken, Bäume, Bodendecker, Wurzeln, Moos, Leuchtkapseln
  light.js          der Stern, sein Zyklus, das Fülllicht
  beams.js          die Lichtschächte (Volumen-Raymarch mit Tiefenokklusion)
  dust.js           Staub, GPU-seitig bewegt und pro Partikel beleuchtet
  post.js           HDR-Puffer, Bloom, Tonemapping, Vignette, Korn
  player.js         Gehen, Umsehen, Kollision, Schwebemodus
  audio.js          das ganze Sounddesign, in Echtzeit synthetisiert
  overlay.js        die fünf Sätze, die die Halle sagen darf
  main.js           Bootstrap, Frame-Loop, adaptive Auflösung
tools/build-station.mjs   Single-File-Build
```

## Performance

Die Qualitätsstufe wird beim Start aus Kernen, Speicher und Displaygröße
gewählt und steuert Schattenauflösung, Schrittzahl im Volumen-Shader,
Partikeldichte, Bloom, MSAA und ob das Glas echte Transmission bekommt. Fällt
die Bildrate darunter, wird ausschließlich die Renderauflösung gesenkt —
Detailgrad vor Auflösung.

Der Bildstapel ist von Hand geschrieben (`EffectComposer` liegt in den
Three.js-Examples, und hier ist nur der Kern eingecheckt): Szene in einen
Halbfloat-Puffer mit Tiefentextur, Schächte in halber Auflösung in einen
zweiten, dann ein Kompositdurchgang mit ACES-Tonemapping, Vignette, leichter
Aberration und Korn.
