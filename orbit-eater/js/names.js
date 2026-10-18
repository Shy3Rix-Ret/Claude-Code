/**
 * Bot-Namen: deutsch-englischer Mix, harmlos, mit Augenzwinkern.
 * Der Pool sorgt dafür, dass kein Name doppelt gleichzeitig im Spiel ist.
 */
import { random } from './utils.js';

export const BOT_NAMES = [
  'Kartoffelkönig', 'Planet Pommes', 'Lauch im All', 'Mondkalb', 'Sternschnuppe99',
  'Gravitas Maximus', 'Orbit Olaf', 'Spacegurke', 'Kevin vom Mars', 'Major Tom Tom',
  'Sputnik Sven', 'Galaxy Brain', 'Big Bang Bernd', 'Kometen-Kalle', 'Ehrenfrau Venus',
  'Brudi vom Saturn', 'Nudelholz 3000', 'Heinz Heliozentrik', 'Pluto war Planet', 'Loch Ness Monster',
  'xX_Krater_Xx', 'Astro Andi', 'Lord Kraterface', 'Milchstraßenbahn', 'Urknall-Uschi',
  'Captain Kaffeesatz', 'Raumzeit-Ralf', 'NASA-Praktikant', 'Fly Me to the Mond', 'Jupiter Jürgen',
  'Gaswolke Gabi', 'Supernova Svenja', 'Dr. Dunkle Materie', 'Rakete Renate', 'Ufo-Uwe',
  'Lichtjahr Lisa', 'Meteor Mehmet', 'Nebel Nils', 'No Gravity No Problem', 'Sternenstaubsauger',
  'Saturn-Ringo', 'Vollmond Vroni', 'Weltraumschrott', 'Orbitbrötchen', 'Sonnensturm Stefan',
  'Kuiper Kai', 'Roter Riese Rolf', 'Weißer Zwerg Willi', 'Neutronen-Nadine', 'Quasar Qualle',
  'Bratwurst Nebula', 'Hubble Bubble', 'Mondfinsternis', 'Krater Kevin', 'Schwerkraft Schorsch',
  'Asteroiden-Achim', 'Polarlicht Paula', 'Ereignishorizont Ede', 'Venus Vibes', 'Mars Macchiato',
  'Kosmo Klaus', 'Sternbild Steffi', 'Umlaufbahn Udo', 'Gravitations-Gerd', 'Andromeda Andrea',
  'Raumstation Rüdiger', 'Pulsar Pia', 'Orion Ottokar', 'Lightspeed Lena', 'Meteorit Moritz',
  'Mondlandung Manni', 'Kosmischer Keks', 'Zentrifugen-Zoe', 'Nebula Nadja', 'Rotverschiebung',
  'Galaxis Gustav', 'Planetenpaule', 'Space Spätzle', 'Schwarzloch Schmidt', 'Trabant Torsten',
  'Fixstern Fritz', 'Astronautin Anke', 'Satelliten-Sabine', 'Cosmic Kartoffel', 'Eisriese Ingo',
  'Tim Teleskop', 'Big Dipper Dieter', 'Sonnenwind Sina', 'Raketen-Rainer', 'Hyperraum Hanna',
];

export class NamePool {
  constructor(names = BOT_NAMES) {
    this.all = names;
    this.used = new Set();
  }

  take() {
    const free = this.all.filter(n => !this.used.has(n));
    let name;
    if (free.length) {
      name = free[Math.floor(random() * free.length)];
    } else {
      // Mehr Bots als Namen: durchnummerieren statt doppeln
      let i = 2;
      do name = `${this.all[Math.floor(random() * this.all.length)]} ${i++}`;
      while (this.used.has(name));
    }
    this.used.add(name);
    return name;
  }

  release(name) {
    this.used.delete(name);
  }
}
