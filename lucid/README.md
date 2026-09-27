# Klartraum

Kleine Offline-Web-App zum Lernen von luzidem Träumen. Alles in einer HTML-Datei,
keine Abhängigkeiten, Daten bleiben lokal im Browser (`localStorage`).

- **Heute:** Realitätscheck-Button mit Tageszähler, zufällig gestreute Erinnerungen
  in einem Zeitfenster, Absicht für die Nacht, Top-Traumzeichen aus dem Tagebuch.
- **Tagebuch:** Träume mit Datum, Klarheit, Traumzeichen und „luzid“-Markierung; Suche.
- **Nacht:** WBTB-Rechner (Schlafzyklen à 90 Min) mit sanftem In-App-Wecker,
  Schritt-für-Schritt-MILD, Rotlicht-Nachtmodus.
- **Lernen:** RC, Tagebuch, MILD, WBTB, SSILD, WILD, Traum stabilisieren. Export/Import als JSON.

## Starten

`index.html` direkt öffnen geht. Für Offline-Modus und „Zum Startbildschirm hinzufügen“
braucht es http(s), z. B.:

```
npx serve lucid     # oder: python3 -m http.server -d lucid
```

Browser-Timer werden bei gesperrtem Bildschirm oft angehalten. Erinnerungen und der
WBTB-Wecker sind deshalb ein Extra, kein Ersatz für den Handywecker.
