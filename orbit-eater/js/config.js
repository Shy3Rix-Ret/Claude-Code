/**
 * ORBIT EATER — Konfiguration
 * ---------------------------------------------------------------------------
 * Jede Stellschraube des Spiels lebt in dieser Datei. Wer balancen will,
 * muss nirgendwo anders suchen.
 *
 * Einheiten:
 *   Strecken   Welt-Einheiten (bei Zoom 1 entspricht das einem CSS-Pixel)
 *   Zeiten     Sekunden
 *   Tempo      Einheiten pro Sekunde
 *   Masse      dimensionslos — Radius = BODY.radiusK * sqrt(Masse)
 */

export const SIM = {
  hz: 60,                 // feste Physik-Rate
  maxStepsPerFrame: 5,    // mehr Nachholschritte pro Frame verhindern nur die "Todesspirale"
};

export const WORLD = {
  radius: 8000,           // kreisförmige Arena
  gridCell: 160,          // Zellgröße des Spatial Hash
  wallBounce: 0.35,
};

/**
 * Fläche im Verhältnis zur 4000er-Arena, auf der alle Mengen ausbalanciert
 * wurden. Staub, Asteroiden, Bots, Kometen und Löcher skalieren damit, so
 * bleibt die Dichte gleich — eine größere Welt ist nicht leerer, nur weiter.
 */
const AREA = (WORLD.radius / 4000) ** 2;
const perArea = n => Math.round(n * AREA);

export const BODY = {
  radiusK: 4.2,
  startMass: 22,
  minMass: 10,            // fällt ein Körper darunter (Treffer), zerbricht er
  speedBase: 265,         // Höchsttempo bei Referenzmasse
  speedRefMass: 22,
  speedExp: -0.2,         // Tempo ~ (Masse / Referenz) ^ speedExp
  steerRate: 4.2,         // wie schnell die Geschwindigkeit dem Wunsch folgt (1/s) — das ist die Trägheit
  steerExp: -0.12,        // schwere Körper sind träger
  radiusEase: 7,          // Radius wächst weich statt sprunghaft (1/s)
  eatRatio: 0.85,         // alles unter 85 % meiner Masse ist fressbar
  eatReach: 0.25,         // so weit (Anteil des Opferradius) darf das Opfer noch überstehen
  eatEfficiency: 1,
  consumeTime: 0.32,      // Dauer der "Einsaug"-Animation
  bounce: 0.7,
  bounceMinSpeed: 110,    // gleich schwere Körper prallen spürbar ab
  boostMul: 1.75,
  boostMinMass: 30,       // darunter kein Boost
  boostCostRate: 0.012,   // Anteil der Masse pro Sekunde
  boostCostMin: 0.9,      // Mindestkosten pro Sekunde
  decayStart: 250,        // ab hier kostet Bewegung Masse ("Reibung") — hält Riesen in Schach
  decayRate: 0.005,       // Anteil der Masse über decayStart pro Sekunde, bei voller Fahrt.
                          // Skaliert mit dem Tempo: Wer stillsteht, verliert nichts.
  decayMax: 120,          // höchstens so viel pro Sekunde — sonst wäre die Galaxie-Ära nicht zu halten
  gravityMul: 2.6,        // Gravitationsradius = r * gravityMul + gravityAdd
  gravityAdd: 36,
  bodyPull: 150,          // Sog großer Körper auf fressbare kleinere (Einheiten/s² am Rand der Oberfläche)
  spawnShield: 3,         // Sekunden Schutz nach dem Spawn
  maxMass: 75000,         // Obergrenze — sonst verstopft ein Riese irgendwann die ganze Arena
  spawnFade: 0.6,
};

/**
 * Evolutionsstufen. `min` ist die Masse, ab der die Stufe erreicht wird.
 * Die Abstände wachsen um ~30 % pro Stufe: Am Anfang kommt alle 15–30 s eine
 * neue Stufe, die letzten fünf sind etwas für Dominanz (oder die Admin-Konsole).
 * Danach folgt die Galaxie-Ära mit 50 eng gestaffelten Stufen — reines Endgame.
 * Das Aussehen jeder Stufe steht in sprites.js bzw. galaxies.js unter demselben `key`.
 */
export const STAGES = [
  { key: 'asteroid',   name: 'Asteroid',        min: 0,    line: 'Klein, kantig, hungrig.' },
  { key: 'moon',       name: 'Mond',            min: 40,   line: 'Jetzt mit Kratern. Und Ambitionen.' },
  { key: 'icemoon',    name: 'Eismond',         min: 70,   line: 'Außen gefroren, innen ein Ozean voller Pläne.' },
  { key: 'lavamoon',   name: 'Lavamond',        min: 110,  line: 'Ständig am Brodeln. Wie ein Gruppenchat um Mitternacht.' },
  { key: 'desert',     name: 'Wüstenplanet',    min: 160,  line: 'Viel Sand, wenig Gnade.' },
  { key: 'ocean',      name: 'Ozeanplanet',     min: 230,  line: 'Blau, wolkig, bewohnbar. Fast schon gemütlich.' },
  { key: 'cloud',      name: 'Wolkenwelt',      min: 320,  line: 'Dicke Luft. Und zwar überall.' },
  { key: 'icegiant',   name: 'Eisriese',        min: 430,  line: 'Kalt, blau und ziemlich schräg unterwegs.' },
  { key: 'gasgiant',   name: 'Gasriese',        min: 570,  line: 'Hauptsächlich heiße Luft. Aber sehr viel davon.' },
  { key: 'ringgiant',  name: 'Ringriese',       min: 750,  line: 'Schmuck ist Pflicht.' },
  { key: 'browndwarf', name: 'Brauner Zwerg',   min: 980,  line: 'Fast ein Stern. Fast.' },
  { key: 'reddwarf',   name: 'Roter Zwerg',     min: 1280, line: 'Die erste eigene Kernfusion. Glückwunsch.' },
  { key: 'sun',        name: 'Sonne',           min: 1650, line: 'Ab jetzt drehen sich die anderen um dich.' },
  { key: 'bluegiant',  name: 'Blauer Riese',    min: 2100, line: 'Heiß, hell, laut. Nicht lange, aber spektakulär.' },
  { key: 'redgiant',   name: 'Roter Überriese', min: 2700, line: 'Aufgebläht und stolz drauf.' },
  { key: 'neutron',    name: 'Neutronenstern',  min: 3500, line: 'Ein Teelöffel von dir wiegt eine Milliarde Tonnen.' },
  { key: 'blackhole',  name: 'Schwarzes Loch',  min: 4500, line: 'Licht? Kommt hier nicht mehr raus.' },
  { key: 'quasar',     name: 'Quasar',          min: 6000, line: 'Du leuchtest heller als ganze Galaxien.' },
  { key: 'galaxy',     name: 'Galaxie',         min: 8000, line: 'Hundert Milliarden Sterne. Und das ist erst der Anfang.' },

  // --- Galaxie-Ära: 50 Stufen, ~4 % Masse Abstand. Echte Galaxientypen und -objekte,
  //     von Zwerggalaxien über Haufen bis zum kosmischen Netz. Aussehen: galaxies.js
  { key: 'dwarf',        name: 'Zwerggalaxie',              min: 8300,  line: 'Ganz unten in der Galaxien-Nahrungskette. Schon wieder.' },
  { key: 'smc',          name: 'Kleine Magellansche Wolke', min: 8700,  line: 'Unordentlich, aber mit Persönlichkeit.' },
  { key: 'lmc',          name: 'Große Magellansche Wolke',  min: 9000,  line: 'Die große Schwester. Mit eigenem Balken.' },
  { key: 'm33',          name: 'Dreiecksgalaxie',           min: 9400,  line: 'Fluffig wie Zuckerwatte. Nur mit Sternen.' },
  { key: 'milkyway',     name: 'Milchstraße',               min: 9700,  line: 'Irgendwo hier drin spielt gerade jemand Orbit Eater.' },
  { key: 'm63',          name: 'Sonnenblumengalaxie',       min: 10000, line: 'Blüht seit zehn Milliarden Jahren. Gießen nicht nötig.' },
  { key: 'm101',         name: 'Feuerradgalaxie',           min: 10500, line: 'Dreht sich, glüht, macht Ärger.' },
  { key: 'm51',          name: 'Strudelgalaxie',            min: 11000, line: 'Bringt ihren Kumpel einfach mit.' },
  { key: 'm31',          name: 'Andromedagalaxie',          min: 11500, line: 'Die Nachbarin. Kommt in 4,5 Milliarden Jahren vorbei.' },
  { key: 'm64',          name: 'Black-Eye-Galaxie',         min: 11750, line: 'Hat sich mit dem Falschen angelegt.' },
  { key: 'm104',         name: 'Sombrerogalaxie',           min: 12250, line: 'Der Hut steht dir. Ehrlich.' },
  { key: 'spindle',      name: 'Spindelgalaxie',            min: 12750, line: 'Von der Seite ein Strich. Von vorne eine Legende.' },
  { key: 'barred',       name: 'Balkenspiralgalaxie',       min: 13250, line: 'Jetzt mit Balken. Wofür? Für die Optik.' },
  { key: 'lenticular',   name: 'Linsengalaxie',             min: 13750, line: 'Alle Arme abgegeben. Endlich Ruhe.' },
  { key: 'hoag',         name: 'Hoags Objekt',              min: 14500, line: 'Ein perfekter Ring. Niemand weiß, wie. Du auch nicht.' },
  { key: 'cartwheel',    name: 'Wagenradgalaxie',           min: 15000, line: 'Jemand ist mitten durchgefahren. Sieht trotzdem gut aus.' },
  { key: 'polarring',    name: 'Polarringgalaxie',          min: 15500, line: 'Zwei Scheiben, null Kompromisse.' },
  { key: 'm82',          name: 'Zigarrengalaxie',           min: 16250, line: 'Raucht. Ist ungesund. Macht aber Sterne.' },
  { key: 'elliptical',   name: 'Elliptische Galaxie',       min: 16750, line: 'Rund, ruhig, uralt. Ein Opa mit hundert Milliarden Sternen.' },
  { key: 'shell',        name: 'Schalengalaxie',            min: 17500, line: 'Trägt ihre Mahlzeiten als Jahresringe.' },
  { key: 'cena',         name: 'Centaurus A',               min: 18250, line: 'Hat eine Spiralgalaxie gefressen. Man sieht es noch.' },
  { key: 'm87',          name: 'Messier 87',                min: 19000, line: 'Ihr Schwarzes Loch war das erste mit Foto. Promi.' },
  { key: 'seyfert',      name: 'Seyfert-Galaxie',           min: 19750, line: 'Der Kern leuchtet heller als der Rest. Typisch Hauptcharakter.' },
  { key: 'radio',        name: 'Radiogalaxie',              min: 20500, line: 'Sendet auf allen Frequenzen. Niemand hat gefragt.' },
  { key: 'blazar',       name: 'Blazar',                    min: 21250, line: 'Zielt mit dem Jet genau auf dich. Unhöflich.' },
  { key: 'pair',         name: 'Galaxienpaar',              min: 22250, line: 'Zu zweit ist man weniger allein.' },
  { key: 'mice',         name: 'Mäusegalaxien',             min: 23000, line: 'Zwei Mäuse, sehr lange Schwänze. Keine Katze in Sicht.' },
  { key: 'tadpole',      name: 'Kaulquappengalaxie',        min: 24000, line: 'Wird irgendwann ein Frosch. Vielleicht.' },
  { key: 'antennae',     name: 'Antennengalaxien',          min: 25000, line: 'Empfang: fünf Balken.' },
  { key: 'merger',       name: 'Galaxienverschmelzung',     min: 26000, line: 'Zwei Galaxien, eine Wohnung. Wird schon gutgehen.' },
  { key: 'cd',           name: 'cD-Riesengalaxie',          min: 27000, line: 'Isst alles, was in die Nähe kommt. Kennt man ja.' },
  { key: 'ic1101',       name: 'IC 1101',                   min: 28000, line: 'Die größte bekannte Galaxie. Bis du kamst.' },
  { key: 'localgroup',   name: 'Lokale Gruppe',             min: 29250, line: 'Familientreffen. Andromeda hat Kuchen mitgebracht.' },
  { key: 'quintet',      name: 'Stephans Quintett',         min: 30500, line: 'Fünf Galaxien, ein Gruppenchat.' },
  { key: 'sextet',       name: 'Seyferts Sextett',          min: 31500, line: 'Sechs Galaxien auf engstem Raum. Wie eine WG.' },
  { key: 'cluster',      name: 'Galaxienhaufen',            min: 33000, line: 'Tausend Galaxien. Und alle wollen in deinen Orbit.' },
  { key: 'virgo',        name: 'Virgo-Haufen',              min: 34000, line: 'Der Nachbarhaufen. Mit Promi-Galaxie in der Mitte.' },
  { key: 'coma',         name: 'Coma-Haufen',               min: 35500, line: 'Hier wurde die Dunkle Materie entdeckt. Seitdem sucht man sie.' },
  { key: 'lens',         name: 'Gravitationslinse',         min: 37000, line: 'Biegt Licht. Einfach, weil sie es kann.' },
  { key: 'bullet',       name: 'Bullet-Cluster',            min: 38500, line: 'Dunkle Materie, beim Überholen erwischt.' },
  { key: 'supercluster', name: 'Superhaufen',               min: 40000, line: 'Haufen von Haufen. Es wird unübersichtlich.' },
  { key: 'laniakea',     name: 'Laniakea',                  min: 41500, line: 'Hawaiianisch für „unermesslicher Himmel“. Der gelbe Punkt bist du.' },
  { key: 'attractor',    name: 'Großer Attraktor',          min: 43000, line: 'Zieht alles an. Was genau, verdeckt die Milchstraße.' },
  { key: 'wall',         name: 'Große Mauer',               min: 45000, line: 'Eine Mauer aus Galaxien. Wer hat die bezahlt?' },
  { key: 'filament',     name: 'Kosmisches Filament',       min: 46500, line: 'Ein Faden aus Galaxien. Bitte nicht dran ziehen.' },
  { key: 'web',          name: 'Kosmisches Netz',           min: 48500, line: 'Das Universum ist ein Spinnennetz. Und du bist die Spinne.' },
  { key: 'void',         name: 'Kosmische Leere',           min: 50500, line: 'Hier ist nichts. Fast nichts. Jetzt: du.' },
  { key: 'universe',     name: 'Beobachtbares Universum',   min: 52500, line: '93 Milliarden Lichtjahre. Und du in der Mitte. Wie immer.' },
  { key: 'multiverse',   name: 'Multiversum',               min: 54500, line: 'Ein Universum war dir nicht genug. Natürlich nicht.' },
  { key: 'orbiteater',   name: 'Orbit Eater',               min: 57000, line: 'Du bist jetzt das Spiel. Mehr geht wirklich nicht.' },
];
/** Index der ersten Galaxie — ab hier beginnt die Galaxie-Ära. */
export const GALAXY_STAGE = STAGES.findIndex(s => s.key === 'galaxy');
/** Abstieg erst, wenn die Masse 10 % unter die Stufengrenze fällt — sonst flackert die Stufe. */
export const STAGE_DOWN = 0.9;

export const ORBIT = {
  captureRatio: 3,        // ein Körper fängt Brocken ein, die höchstens 1/3 so schwer sind
  maxBase: 3,             // maximale Orbiter = maxBase + sqrt(Masse) * maxPerSqrtMass
  maxPerSqrtMass: 0.45,
  maxCap: 22,
  gapMin: 0.22,           // Bahnhöhe als Anteil der Brunnentiefe (Gravitationsradius − r)
  gapMax: 0.62,
  minGap: 5,
  speed: 105,             // Bahngeschwindigkeit
  speedPerSqrtMass: 1.5,  // große Körper: schnellere Bahnen …
  speedBonusMax: 90,      // … aber nur bis zu diesem Aufschlag
  blendTime: 0.75,        // weicher Übergang vom freien Flug in die Umlaufbahn
  accretionRate: 0.22,    // Masse pro Sekunde, die jeder Orbiter an den Körper abgibt
  decay: 0.03,            // Bahn sinkt langsam
  absorbMass: 0.6,        // darunter wird der Rest geschluckt
};

export const SLING = {
  chargeTime: 0.9,
  minCharge: 0.12,        // kürzeres Klicken lädt nicht
  spinBoost: 2.6,         // Orbiter drehen beim Laden schneller
  tension: 12,            // Bahnen weiten sich beim Laden
  burstInterval: 0.045,   // Abstand zwischen zwei Schüssen einer Salve
  speedMin: 560,
  speedMax: 1080,
  spread: 0.06,           // Streuung in Radiant
  inheritVelocity: 0.6,
  life: 1.5,
  drag: 0.55,
  damagePerMass: 2.6,     // Schaden = Projektilmasse * damagePerMass * Ladung
  knockback: 26,
  sprayFraction: 0.55,    // so viel des Schadens fällt als Staub heraus
  sprayMax: 24,
  immuneTime: 1.4,        // abgefeuerte Brocken kann der Schütze nicht sofort wieder einfangen
};

export const DUST = {
  count: perArea(1800),
  mass: 1,
  radius: 4,
  clusterMin: 4,
  clusterMax: 14,
  clusterSpread: 80,
  clustersPerSecond: 3.4 * AREA,
  drift: 10,
  drag: 1.4,
  pullFactor: 1.5,        // Einfallgeschwindigkeit als Vielfaches des Gravitationsradius pro Sekunde
  swirl: 0.6,             // tangentialer Anteil → Spiralen
  response: 6,
  fadeIn: 0.5,
  dropImmune: 1.2,        // eigener Boost-Staub wird nicht sofort wieder eingesaugt
};

export const ASTEROID = {
  count: perArea(130),
  massMin: 3,
  massMax: 9,
  radiusK: 3.6,           // r = radiusK * sqrt(Masse)
  drift: 26,
  drag: 0.35,
  spawnPerSecond: 2 * AREA,
  pullFactor: 0.8,
  variants: 12,
};

export const COMET = {
  max: perArea(3),
  intervalMin: 5 / AREA,
  intervalMax: 11 / AREA,
  firstDelay: 4,
  speedMin: 360,
  speedMax: 500,
  reward: 24,
  mass: 2,
  radius: 7,
  gravity: 26000,         // echte 1/r²-Ablenkung durch Gravitationsbrunnen
};

export const BLACK_HOLE = {
  max: perArea(2),
  firstDelay: 45,
  intervalMin: 40 / AREA,
  intervalMax: 80 / AREA,
  lifeMin: 70,
  lifeMax: 110,
  formTime: 3.5,
  collapseTime: 2.5,
  radiusMin: 40,
  radiusMax: 58,
  maxRadius: 90,
  growthPerMass: 0.012,
  pullMul: 15,            // Sogradius = r * pullMul
  pullAccel: 1150,        // Beschleunigung am Ereignishorizont, fällt quadratisch ab
  drainRate: 0.45,        // Anteil Masse pro Sekunde, den ein überlappender Riese verliert
  drift: 16,
  safeSpawnDist: 1400,
  collapseDust: 36,
};

export const BOTS = {
  count: perArea(20),
  respawnMin: 2,
  respawnMax: 5,
  thinkMin: 0.12,
  thinkMax: 0.28,
  viewBase: 620,          // Wahrnehmungsradius = viewBase + r * viewPerRadius
  viewPerRadius: 5,
  threatRange: 300,
  turnRate: 5,
  slingMinOrbiters: 3,
  slingRange: 640,
  nearPlayerChance: 0.5,  // Anteil der Respawns, deren Masse sich am Spieler orientiert
  massBands: [            // Verteilung der Startmassen
    { w: 0.40, min: 15,  max: 55 },
    { w: 0.30, min: 55,  max: 170 },
    { w: 0.18, min: 170, max: 450 },
    { w: 0.09, min: 450, max: 1000 },
    { w: 0.03, min: 1000, max: 1700 },
  ],
  fullDifficultyMass: 900,
  skillMinScale: 0.72,    // Bot-Präzision, solange der Spieler klein ist
  playerAggroMin: 0.4,    // wie gern Bots einen kleinen Spieler jagen
  graceTime: 20,          // Schonfrist nach dem Spawn (Jagdlust steigt von 25 % auf 100 %)
};

export const COMBO = {
  window: 1.1,            // so lange darf zwischen zwei Bissen liegen
  step: 0.025,            // +2,5 % Masse pro Kombostufe
  maxSteps: 24,           // also höchstens ×1,6
  showFrom: 3,
};

export const CAMERA = {
  followRate: 5.5,
  zoomRate: 2.2,
  baseScreenR: 20,        // Bildschirmradius des Spielers bei Startgröße (CSS-px, bezogen auf refHeight)
  growthExp: 0.45,        // Bildschirmradius wächst mit r^growthExp, der Rest wird herausgezoomt
  refHeight: 900,
  minZoom: 0.1,
  maxZoom: 2.4,
  lead: 0.22,             // Kamera schaut etwas in Bewegungsrichtung voraus
  shakeMax: 22,
  shakeDecay: 1.8,
  menuZoom: 0.42,
};

export const RENDER = {
  maxDpr: 2,
  particles: 2400,
  nameMinScreenR: 9,      // kleinere Körper bekommen kein Namensschild
};

export const AUDIO = {
  volume: 0.7,
  eatMinGap: 0.045,       // Fress-Sounds höchstens alle 45 ms
  hearRange: 1800,        // Ereignisse außerhalb dieser Distanz sind stumm
};

/** Farbsystem — identisch zu den CSS-Variablen in style.css. */
export const PALETTE = {
  void: '#05070b',
  paper: '#ece6d6',
  amber: '#ffb347',
  prey: '#8ff0a4',
  threat: '#ff5b4f',
  neutral: '#c9d3e6',
  teal: '#5fb8c9',
  dust: ['#ffcf7a', '#6fdce8', '#ff9b7a', '#a9d4ff'],
};
