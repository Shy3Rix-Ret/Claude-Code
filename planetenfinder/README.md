# Planetenfinder

Handy an den Himmel halten und sehen, wo Saturn steht. Die App rechnet die
Position von Sonne, Mond und allen Planeten für den aktuellen Standort und die
aktuelle Sekunde aus und zeichnet sie dorthin, wo das Handy gerade hinzeigt.
Drehst du dich weg, verschwinden sie aus dem Bild — genau wie das echte Objekt.

Keine Registrierung, kein Server, keine Netzwerkanfrage. Alles rechnet das
Gerät selbst.

---

## Starten

**Entwicklung** (ES-Module brauchen einen echten Origin):

```
node tools/serve.mjs        # aus dem Repo-Wurzelverzeichnis
                            # → http://localhost:4444/planetenfinder/
```

**Einzeldatei bauen:**

```
npm install --no-save esbuild
node planetenfinder/tools/build.mjs
node planetenfinder/tools/icons.mjs     # nur nötig, wenn sich das Icon ändert
```

Ergebnis: `planetenfinder/dist/planetenfinder.html`, rund 120 KB, komplett
offline lauffähig.

> **Wichtig fürs Handy:** Lagesensoren, Kompass, GPS und Kamera gibt es im
> Browser nur in einem *sicheren Kontext* — also über `https://` oder
> `localhost`. Per Doppelklick vom Dateisystem geöffnet bleiben die Sensoren
> stumm; die App merkt das und schaltet auf Ziehen mit dem Finger um. Zum
> echten Ausprobieren die Datei also auf einen HTTPS-Host legen (oder im
> lokalen Netz mit einem Tunnel wie `ngrok`/`cloudflared` servieren).
>
> Auf iOS fragt die App beim Start nach der Freigabe der Bewegungssensoren.
> Diese Abfrage funktioniert nur direkt nach einem Fingertipp — deshalb der
> Startknopf.

## Die fünf Ansichten

| | |
|---|---|
| **Live** | Der Himmel in Blickrichtung. Objekte stehen dort, wo sie am Himmel stehen; wahlweise über dem Kamerabild. |
| **Karte** | Der ganze Himmel auf einmal: Mitte = Zenit, Ring = Horizont. Ein Keil zeigt, wohin das Handy zeigt. |
| **Objekte** | Höhe, Richtung, Helligkeit, Entfernung, Lichtlaufzeit, Auf- und Untergang, Mondphase, Dämmerungszeiten. |
| **Termine** | Was als Nächstes passiert, mit laufendem Countdown auf die Sekunde. |
| **Zeit** | Den Himmel um bis zu 24 Stunden vor- und zurückdrehen — praktisch, um zu sehen, wann ein Planet hoch genug steht. |

Ein Objekt antippen (in der Liste, in der Live-Ansicht oder auf der Karte)
öffnet die Details. Von dort lässt sich es als **Ziel** setzen: ein Pfeil am
Bildrand zeigt dann, in welche Richtung und wie weit noch zu drehen ist, bis es
im Bild ist. Das ist der schnellste Weg zu Uranus und Neptun, die man ohne
Hilfe nicht findet.

### Termine

Der Countdown oben zeigt nicht den nächsten Sonnenuntergang, sondern das
nächste *Highlight*. Darunter läuft die vollständige Liste, nach Heute, Diese
Woche, Diesen Monat und Später gruppiert:

- **Finsternisse**, Sonne wie Mond. Diese sind nicht nachgeschlagen, sondern
  aus derselben Ephemeride gerechnet — deshalb steht dabei, was *von deinem
  Standort aus* davon zu sehen ist. Dieselbe Finsternis am 12.08.2026 ist auf
  Island total, in Zürich eine partielle mit 93 % bedeckter Sonnenfläche bei
  3° Höhe, und in Sydney gar nichts.
- **Oppositionen** — die Nacht, in der ein Planet der Erde am nächsten steht,
  die ganze Nacht sichtbar ist und am hellsten leuchtet.
- **Größte Elongationen** von Merkur und Venus, mit Abend- oder Morgenhimmel.
- **Begegnungen**: Mond und Planeten, die sich bis auf wenige Grad nähern.
  Kommen sie sich näher als der Mondradius, heißt es richtigerweise
  „bedeckt“ statt „trifft“.
- **Mondphasen**, **Sternschnuppenströme** (mit der Frage, ob der Mond stört)
  und die Eckdaten der Nacht: Sonnenuntergang, Dämmerungsphasen, Mondaufgang.

Ein Ereignis antippen öffnet zwei Knöpfe: **Himmel zu dieser Zeit** stellt die
Uhr der ganzen App auf diesen Moment und wechselt auf die Karte — man sieht
also vorher, wo genau am Horizont es passieren wird. Und **als Ziel setzen**
legt den Führungspfeil auf das beteiligte Objekt.

### Realistische Grafik

Standardmäßig an, in den Einstellungen abschaltbar.

**Die Umgebung** ist kein Farbverlauf mehr, sondern ein Streumodell, das pro
Blickrichtung ausgewertet wird. Dazu die Milchstraße, aus galaktischen
Koordinaten in den Himmel zurückgerechnet: der helle Hof um die Sonne, der Dunst, der zum
Horizont hin dichter wird, das orange Band bei Sonnenuntergang — und
gegenüber davon der Erdschatten, der aus dem Horizont steigt, mit dem rosa
Band der Venusgürtels darüber. Nachts kommen Mondlicht und die Lichtglocke
über dem Horizont dazu. Sterne funkeln, und zwar am Horizont stärker als im
Zenit, weil dort mehr Luft im Weg ist; ihre Farben sind die echten
Spektralfarben, Beteigeuze also orangerot und Rigel blauweiß.

**Die Körper** bekommen ihr richtiges Gesicht: Saturn mit Ringen im
tatsächlichen Öffnungswinkel des Jahres (2026 fast auf der Kante, nach dem
Ringebenendurchgang von 2025), Jupiter abgeplattet und gebändert, Mars rötlich
mit Polkappe, Venus und Merkur mit Phase, die Sonne mit Korona, der Mond mit
seinen Maria. Phasen zeigen immer zur Sonne, auch wenn die längst untergegangen
ist.

Zur Größe, weil das sonst irreführend wäre: **Sonne und Mond werden in wahrer
Größe gezeichnet** und wachsen beim Zoomen mit. Die Planeten dagegen bleiben
absichtlich viel zu groß — sie werden gezeichnet, als sähe man sie durch ein
kleines Teleskop bei 100-facher Vergrößerung, was ungefähr die Vergrößerung
ist, ab der Saturns Ringe auffallen. In Wahrheit misst Jupiter 47
Bogensekunden, ein Zwanzigstel Pixel.

Kostenpunkt: nichts. Das Modell läuft in einen kleinen Puffer, der
hochskaliert wird; gemessen 60 fps mit und ohne. (Der teure Teil war nicht die
Rechnung, sondern der Hochskalier-Filter — `imageSmoothingQuality: 'high'`
halbierte die Bildrate, bilinear aus einem dichteren Puffer sieht bei
Farbverläufen gleich aus und kostet nichts.)

### Deep-Sky

Rund dreißig Objekte, die sich mit bloßem Auge oder einem Fernglas wirklich
lohnen: Andromedagalaxie, Orionnebel, Plejaden, Herkuleshaufen, das
Doppelsternhaufen-Paar in Perseus und so weiter. Kein Katalog mit
achttausend Galaxien — auf einem Handydisplay im Dunkeln wäre das eine
schlechtere App.

Sie werden **in wahrer Größe** gezeichnet, und das ist der Punkt: die
Andromedagalaxie ist sechsmal so breit wie der Vollmond, und fast niemand
weiß das, bevor er es einmal maßstäblich gesehen hat. In der Objektliste
steht zu jedem, was man dafür braucht — bloßes Auge, Fernglas oder Teleskop.

### Höhenkurve

In jeder Detailseite steckt ein Diagramm der Höhe über die nächsten 24
Stunden, mit dem Tageslicht als hellem Hintergrund. Das beantwortet die
Frage, die eine Liste von Auf- und Untergangszeiten nicht beantwortet:
*wann* lohnt es sich rauszugehen. Ein Objekt, das die ganze Nacht über
knapp über den Dächern hängt, ist etwas anderes als eines, das drei Stunden
lang 60° hoch steht — und die Form der Kurve zeigt sofort, welches von
beiden es ist.

### Offline und auf dem Home-Bildschirm

Die App bringt ein Web-App-Manifest, ein Icon und einen Service Worker mit.
Über „Zum Home-Bildschirm hinzufügen“ startet sie ohne Browserleiste im
Vollbild, und sie läuft danach **ohne Netz** weiter — was genau dort
gebraucht wird, wo man sie benutzt: auf einer Wiese ohne Empfang. Gerechnet
wird ohnehin alles auf dem Gerät; das Einzige, was je Netz brauchte, war der
Download.

Der Worker holt bewusst zuerst aus dem Netz und erst dann aus dem Cache —
umgekehrt bekäme jemand mit Empfang klaglos den Build von letzter Woche
serviert.

Weitere Schalter: Kamerabild, Sterne, Milchstraße, Sternbilder, Deep-Sky,
Gradnetz, Beschriftungen, untergegangene Objekte, Karte in Blickrichtung
drehen, Nachtmodus (rot), Sichtfeld (auch per Zwei-Finger-Zoom). Die
Objektliste hat ein Suchfeld.

### Die Oberfläche

Die Vorlage ist ein Messinginstrument bei Nacht: warmes Messing als einzige
Akzentfarbe gegen den kalten Himmel, eine Serifenschrift für Namen und
Überschriften, eine Monospace mit Tabellenziffern für alles Gemessene — damit
ein laufender Countdown nicht bei jeder Sekunde die Breite wechselt. Keine
zweite Akzentfarbe, keine Verläufe, die um Aufmerksamkeit bitten. Was leuchtet,
leuchtet, weil es am Himmel leuchtet.

Bewegung gibt es, wo sie etwas erklärt, und sonst nicht:

* Eine Messingmarke unter der Leiste gleitet auf den aktiven Reiter, statt
  einfach umzuspringen — das Auge folgt der Bewegung, statt die Änderung zu
  suchen.
* Panels fahren mit einer leichten Federung hoch, ihre Zeilen treffen
  gestaffelt ein. Nur beim Öffnen: die Objektliste frischt sich alle fünf
  Sekunden auf, und eine Liste, die dabei jedes Mal neu einfliegt, ist ein
  Zappeln, kein Detail.
* Der Wechsel Live ↔ Karte blendet kurz durch. Beide teilen sich dieselbe
  Leinwand, da gibt es nichts zu schieben.
* Hinter dem Startbildschirm zieht ein eigener kleiner Sternenhimmel, gelegentlich
  mit Sternschnuppe. Er hält an, sobald der Bildschirm weg ist.

`prefers-reduced-motion` schaltet alles davon ab, inklusive des Startbildschirm-
Himmels, der dann einmal steht statt zu laufen.

## Genauigkeit — und wo sie wirklich endet

Die gerechneten Positionen:

| | |
|---|---|
| Planeten | Bahnelemente des JPL (Standish, gültig 1800–2050) mit Kepler-Lösung. Fehler unter einer Bogenminute innen, wenige Bogenminuten bei Jupiter und weiter außen. |
| Sonne | Aus derselben Erdbahn abgeleitet. |
| Mond | Gekürzte Mondtheorie mit den zwölf größten Störungstermen in Länge (Evektion, Variation, jährliche Gleichung …), fünf in Breite. Etwa 2 Bogenminuten. |
| Dazu | Lichtlaufzeit, Präzession auf das Datum, Hauptterm der Nutation, topozentrische Parallaxe (beim Mond bis zu 1°!) und Refraktion. |

Zum Vergleich: der Vollmond ist 30 Bogenminuten breit. Die Rechnung ist also
deutlich genauer, als das Auge auflösen kann.

### Nachprüfen statt glauben

```
node planetenfinder/tools/verify.mjs
```

Drei Prüfungen, die von außen kontrollierbar sind:

1. **Die totale Sonnenfinsternis vom 12.08.2026.** Eine Finsternis ist nichts
   anderes als Sonne und Mond am selben Fleck — das kommt nur heraus, wenn
   Sonnenstand, Mondstand, Zeitskala und Standortparallaxe gleichzeitig
   stimmen. Ergebnis: 0,55′ Abstand um 17:45 UT (veröffentlicht: 17:46 UT),
   der Mond deckt die Sonne vollständig. Ohne die Standortkorrektur wären es
   54′ — gar keine Finsternis. Kein anderer Test hier ist annähernd so scharf.
2. **Tagundnachtgleiche und Sonnenwende** gegen den Kalender. Der
   Frühlingsanfang landet 16 Minuten zu früh, das sind rund 40 Bogensekunden
   Sonnenlänge — die Grenze der verwendeten Bahnelemente, plus die jährliche
   Aberration, die hier bewusst nicht modelliert ist.
3. **Die Planeten gegen eine zweite, unabhängige Rechnung** (Schlyters
   klassische Methode: andere Bahnelemente, andere Epoche, eigener Code).
   Schlechtester Wert über sechs Zeitpunkte von 2026 bis 2030: Merkur, Venus,
   Mars, Neptun unter 0,5′, Uranus 1,3′, Jupiter 2,9′, Saturn 6,4′. Dass zwei
   unabhängige Wege übereinstimmen, schließt Programmierfehler aus — es
   beweist nicht die zugrunde liegende Theorie.
4. **Die Termine gegen veröffentlichte Werte.** Einmal nachgeschlagen (NASA,
   timeanddate, EarthSky, in-the-sky.org, IMO) und fest eingetragen, damit die
   Übereinstimmung weiter geprüft wird:

   | gerechnet | veröffentlicht |
   |---|---|
   | Größte Verfinsterung 12.08.2026, 17:45:50 UT | 17:45:51 UT |
   | Maximum in Zürich 20:17 MESZ, 92,8 % der Fläche | 20:17–20:21, „rund 90 bis 92 %“ |
   | Mondfinsternis 28.08.2026, 04:13 UT | 04:12 UT |
   | Saturn in Opposition 04.10.2026 | 4. Oktober 2026 |
   | Jupiter in Opposition 11.02.2027 | 11. Februar 2027 |
   | Mars in Opposition 19.02.2027 | 19. Februar 2027 |
   | Venus, größte Elongation 15.08.2026, 45,89° | 15.08.2026, 45°53′ |

Die **Sternschnuppenströme** sind der einzige Teil der Termine, der nicht
gerechnet ist: Meteorströme sind Staubspuren, keine Zweikörperbahnen, da gibt
es nichts zu integrieren. Deren Maxima stehen als Mittelwerte von IMO und AMS
in einer Tabelle, und die App schreibt dazu, dass das Maximum um etwa einen
Tag schwanken kann.

**Die eigentliche Unsicherheit steckt im Magnetkompass des Handys.** 5° bis 15°
Abweichung sind normal, im Gebäude, im Auto oder neben Lautsprechern deutlich
mehr. Dagegen hilft nur Eichen:

1. Ein Objekt in die Bildmitte nehmen, das du wirklich siehst — Mond, Venus,
   die Sonne.
2. In der Objektliste antippen → **„Kompass hierauf eichen“**.

Danach stimmt auch alles andere, weil nur der Azimut verschoben wird. Die Höhe
kommt aus der Schwerkraft und ist ohnehin genau. Alternativ gibt es in den
Einstellungen einen Schieberegler für die Korrektur.

Die Neigung ist übrigens immer verlässlich; wenn also etwas „daneben“ wirkt,
ist es fast sicher die Himmelsrichtung.

## Aufbau

```
src/astro.js      Ephemeriden: Bahnelemente, Kepler, Mondtheorie, Koordinaten-
                  transformationen, Auf-/Untergang, Mondphasen
src/sensors.js    Lagesensoren → Kamerabasis in Ost/Nord/Oben, Kompasseichung,
                  Ersatzsteuerung per Finger
src/skyview.js    Live-Ansicht: Projektion, Himmelsfarben, Boden, Mondphase,
                  Zielführung
src/realistic.js  Streumodell der Atmosphäre, Milchstraße, Ringe, Bänder,
                  Phasen, Funkeln
src/deepsky.js    Galaxien, Nebel und Sternhaufen fürs bloße Auge und Fernglas
src/mapview.js    Horizontkarte, Sichtfeldkeil, Ekliptik
src/stars.js      Sternkatalog bis etwa 2,5 mag und ein paar Sternbildlinien
src/bodies.js     Namen, Farben, Texte
src/events.js     Termine: Finsternisse, Oppositionen, Elongationen,
                  Begegnungen, Mondphasen, Sternschnuppen
src/geo.js        Standort, Voreinstellungen, gespeicherte Einstellungen
src/ui.js         Listen, Detailseiten, Einstellungen
src/main.js       Zustand, Renderschleife, Bedienung
```

Der Trick, warum Objekte beim Wegdrehen verschwinden, steckt in einer einzigen
Zeile: die Sensoren liefern eine Kamerabasis, und die Projektion verwirft alles
mit negativer Vorwärtskomponente. Es gibt keine gesonderte Sichtbarkeitslogik,
die man falsch programmieren könnte.

## Was die App nicht kann

- **Keine magnetische Missweisung von selbst.** Dafür bräuchte es ein
  Weltmagnetfeldmodell; stattdessen gibt es die Eichung über ein sichtbares
  Objekt, die zusätzlich auch alle anderen Kompassfehler mitnimmt.
- **Keine Satelliten (ISS & Co.).** Deren Bahnen ändern sich laufend und
  müssten aus dem Netz geladen werden — das würde das Offline-Versprechen
  brechen.
- **Keine Deep-Sky-Objekte.** Der Sternkatalog ist Orientierungshilfe, kein
  Atlas.
- **Pluto** ist mit 14 mag ein Teleskopobjekt. Er ist trotzdem dabei, weil die
  Frage „wo wäre er?“ berechtigt ist.
