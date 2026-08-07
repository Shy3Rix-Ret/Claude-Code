/**
 * The showpieces beyond the solar system.
 *
 * Deliberately not a catalogue: a few dozen objects that are genuinely worth
 * pointing at with nothing more than eyes or a pair of binoculars, which is
 * the equipment this app assumes. An atlas of eight thousand galaxies would
 * be a different app, and a worse one on a phone screen at night.
 *
 * Positions are J2000. `size` is the largest dimension in arcminutes, which
 * is what decides whether binoculars help — the Andromeda galaxy is six times
 * wider than the Moon, and almost nobody knows that until they see it drawn
 * to scale.
 */

// name, kind, RA hours, Dec degrees, magnitude, size in arcminutes, note
const CATALOGUE = [
  ['Andromedagalaxie', 'galaxy', 0.712, 41.269, 3.4, 190,
    'M31 · Die fernste Sache, die man ohne Hilfsmittel sieht: 2,5 Millionen Lichtjahre.'],
  ['Orionnebel', 'nebula', 5.590, -5.450, 4.0, 85,
    'M42 · Eine Sternentstehungsregion im Schwertgehänge des Orion. Im Fernglas ein deutlicher Nebelfleck.'],
  ['Plejaden', 'cluster', 3.783, 24.117, 1.6, 110,
    'M45 · Das Siebengestirn. Mit bloßem Auge sechs Sterne, im Fernglas Dutzende.'],
  ['Praesepe', 'cluster', 8.668, 19.983, 3.1, 95,
    'M44 · Die Krippe im Krebs. Ohne Hilfsmittel ein Nebelfleck, im Fernglas ein Schwarm.'],
  ['Herkuleshaufen', 'globular', 16.695, 36.467, 5.8, 20,
    'M13 · Eine halbe Million Sterne in einer Kugel. Der schönste Kugelsternhaufen des Nordhimmels.'],
  ['Doppelsternhaufen', 'cluster', 2.333, 57.133, 4.3, 60,
    'h und χ Persei · Zwei offene Haufen nebeneinander, wie geschaffen fürs Fernglas.'],
  ['Lagunennebel', 'nebula', 18.063, -24.383, 6.0, 90,
    'M8 · Im Schützen, mitten in der Milchstraße.'],
  ['Ptolemäus-Haufen', 'cluster', 17.898, -34.817, 3.3, 80,
    'M7 · Schon in der Antike als Nebelfleck notiert. Steht von Mitteleuropa aus sehr tief.'],
  ['Schmetterlingshaufen', 'cluster', 17.668, -32.217, 4.2, 25, 'M6 · Direkt neben M7 im Skorpion.'],
  ['Wildentenhaufen', 'cluster', 18.852, -6.267, 5.8, 14, 'M11 · Dicht gedrängt, im Fernglas ein Keil aus Sternen.'],
  ['Kugelhaufen M22', 'globular', 18.607, -23.900, 5.1, 32, 'M22 · Heller als M13, aber von Norden aus tief.'],
  ['Kugelhaufen M5', 'globular', 15.310, 2.083, 5.6, 23, 'M5 · Einer der ältesten bekannten Haufen.'],
  ['Kugelhaufen M3', 'globular', 13.703, 28.383, 6.2, 18, 'M3 · Ein halbes Million Sterne im Sternbild Jagdhunde.'],
  ['Kugelhaufen M15', 'globular', 21.500, 12.167, 6.2, 18, 'M15 · Kompakter Kern, leicht im Pegasus zu finden.'],
  ['Kugelhaufen M92', 'globular', 17.285, 43.133, 6.4, 14, 'M92 · Der übersehene Nachbar von M13.'],
  ['Hantelnebel', 'nebula', 19.993, 22.717, 7.4, 8, 'M27 · Ein sterbender Stern im Fuchs. Fernglas genügt.'],
  ['Ringnebel', 'nebula', 18.893, 33.033, 8.8, 1.4, 'M57 · Ein Rauchring in der Leier — dafür braucht es ein Teleskop.'],
  ['Bodes Galaxie', 'galaxy', 9.926, 69.067, 6.9, 27, 'M81 · Mit M82 zusammen im selben Fernglasfeld.'],
  ['Zigarrengalaxie', 'galaxy', 9.931, 69.683, 8.4, 11, 'M82 · Von innen heraus zerrissen, direkt neben M81.'],
  ['Strudelgalaxie', 'galaxy', 13.498, 47.195, 8.4, 11, 'M51 · Die erste Galaxie, in der man Spiralarme erkannte.'],
  ['Sombrerogalaxie', 'galaxy', 12.667, -11.617, 8.0, 9, 'M104 · Eine Scheibe mit Staubband, von der Kante gesehen.'],
  ['Dreiecksgalaxie', 'galaxy', 1.564, 30.660, 5.7, 70, 'M33 · Groß, aber flau — braucht einen wirklich dunklen Himmel.'],
  ['Sternhaufen M35', 'cluster', 6.148, 24.333, 5.1, 28, 'M35 · Zu Füßen der Zwillinge, so groß wie der Vollmond.'],
  ['Sternhaufen M41', 'cluster', 6.767, -20.733, 4.5, 38, 'M41 · Vier Grad unter Sirius.'],
  ['Nordamerikanebel', 'nebula', 20.980, 44.333, 4.0, 120,
    'NGC 7000 · Im Schwan, in Form des Kontinents. Nur unter dunklem Himmel.'],
  ['Omega Centauri', 'globular', 13.447, -47.483, 3.7, 36,
    'NGC 5139 · Der größte Kugelsternhaufen am Himmel — von Mitteleuropa aus nicht zu sehen.'],
  ['47 Tucanae', 'globular', 0.402, -72.083, 4.1, 31, 'NGC 104 · Südhimmel, gleich neben der Kleinen Magellanschen Wolke.'],
  ['Große Magellansche Wolke', 'galaxy', 5.393, -69.756, 0.9, 650,
    'Eine Begleitgalaxie der Milchstraße. Vom Südhimmel aus eine abgerissene Wolke.'],
  ['Kleine Magellansche Wolke', 'galaxy', 0.880, -72.833, 2.7, 300, 'Die kleinere der beiden Begleitgalaxien.'],
];

export const DEEP_SKY = CATALOGUE.map(([name, kind, ra, dec, mag, size, note], i) => ({
  id: `dso-${i}`, name, kind, ra, dec, mag, size, note,
}));

export const DSO_KINDS = {
  galaxy: { label: 'Galaxie', colour: '#c8b6ff' },
  nebula: { label: 'Nebel', colour: '#8fe0c0' },
  cluster: { label: 'Offener Sternhaufen', colour: '#ffe9a8' },
  globular: { label: 'Kugelsternhaufen', colour: '#ffc98f' },
};

/** What you need to see it — the only question that matters in the field. */
export function equipmentFor(mag, size) {
  if (mag <= 4.5) return 'bloßes Auge';
  if (mag <= 6.5) return size > 15 ? 'bloßes Auge bei dunklem Himmel' : 'Fernglas';
  if (mag <= 9) return 'Fernglas';
  return 'Teleskop';
}
