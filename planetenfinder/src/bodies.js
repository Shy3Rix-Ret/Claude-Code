/**
 * Names, colours and the couple of sentences shown when a body is tapped.
 * Colours are roughly what the eye reports through a telescope, pushed a
 * little towards saturation so the markers stay apart on a bright screen.
 */

export const BODIES = {
  sun: {
    name: 'Sonne',
    color: '#ffd15c',
    glow: '#ffb020',
    size: 1.6,
    kind: 'star',
    note: 'Nie direkt in die Sonne schauen — auch nicht durch die Handykamera.',
    facts: 'Unser Stern. Licht von hier braucht gut acht Minuten bis zur Erde.',
  },
  moon: {
    name: 'Mond',
    color: '#e8e6df',
    glow: '#cfcabb',
    size: 1.5,
    kind: 'moon',
    facts: 'Der einzige natürliche Trabant der Erde, im Mittel 384.400 km entfernt.',
  },
  mercury: {
    name: 'Merkur',
    color: '#c9b8a4',
    glow: '#8d7d6b',
    size: 0.7,
    kind: 'planet',
    facts: 'Steht nie weit von der Sonne. Nur in der Dämmerung zu sehen, tief am Horizont.',
  },
  venus: {
    name: 'Venus',
    color: '#fff3d0',
    glow: '#ffe08a',
    size: 1.2,
    kind: 'planet',
    facts: 'Nach Sonne und Mond das hellste Objekt am Himmel. Abend- oder Morgenstern.',
  },
  mars: {
    name: 'Mars',
    color: '#ff7b52',
    glow: '#c2402a',
    size: 0.9,
    kind: 'planet',
    facts: 'Deutlich rötlich. In Oppositionsnähe heller als alle Sterne außer Sirius.',
  },
  jupiter: {
    name: 'Jupiter',
    color: '#f6dfc0',
    glow: '#c8a878',
    size: 1.3,
    kind: 'planet',
    facts: 'Ruhig und sehr hell. Schon ein Fernglas zeigt die vier großen Monde.',
  },
  saturn: {
    name: 'Saturn',
    color: '#f0e0b0',
    glow: '#bfa76a',
    size: 1.15,
    kind: 'planet',
    facts: 'Gelblich und ruhig. Die Ringe brauchen ein kleines Teleskop, ab etwa 30-facher Vergrößerung.',
  },
  uranus: {
    name: 'Uranus',
    color: '#a8e4e8',
    glow: '#5fa8b0',
    size: 0.8,
    kind: 'planet',
    facts: 'Unter sehr dunklem Himmel gerade noch mit bloßem Auge. Im Fernglas ein grünliches Scheibchen.',
  },
  neptune: {
    name: 'Neptun',
    color: '#8fb8ff',
    glow: '#4a6fc0',
    size: 0.75,
    kind: 'planet',
    facts: 'Nie mit bloßem Auge sichtbar. Licht von dort ist über vier Stunden unterwegs.',
  },
  pluto: {
    name: 'Pluto',
    color: '#cbbfae',
    glow: '#8a7f70',
    size: 0.55,
    kind: 'dwarf',
    facts: 'Zwergplanet, Magnitude 14 — Teleskopobjekt. Hier steht, wo er wäre.',
  },
};

/** Display order: the naked-eye sky first, then the ones you need optics for. */
export const DISPLAY_ORDER = [
  'moon', 'venus', 'jupiter', 'saturn', 'mars', 'mercury', 'sun', 'uranus', 'neptune', 'pluto',
];

export const bodyName = (id) => BODIES[id]?.name || id;

/** Compass point in German for an azimuth. */
export function compassName(az) {
  const names = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

export function compassShort(az) {
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

/** German name for the lunar phase, from phase angle and direction. */
export function moonPhaseName(illuminated, waxing) {
  const p = illuminated;
  if (p < 0.02) return 'Neumond';
  if (p > 0.98) return 'Vollmond';
  if (Math.abs(p - 0.5) < 0.06) return waxing ? 'Erstes Viertel' : 'Letztes Viertel';
  if (p < 0.5) return waxing ? 'zunehmende Sichel' : 'abnehmende Sichel';
  return waxing ? 'zunehmender Mond' : 'abnehmender Mond';
}
