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
  radius: 4000,           // kreisförmige Arena
  gridCell: 160,          // Zellgröße des Spatial Hash
  wallBounce: 0.35,
};

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
  decayStart: 150,        // ab hier verdunstet Masse langsam (hält Riesen in Bewegung)
  decayRate: 0.007,       // Anteil der Masse über decayStart pro Sekunde
  gravityMul: 2.6,        // Gravitationsradius = r * gravityMul + gravityAdd
  gravityAdd: 36,
  bodyPull: 150,          // Sog großer Körper auf fressbare kleinere (Einheiten/s² am Rand der Oberfläche)
  spawnShield: 3,         // Sekunden Schutz nach dem Spawn
  spawnFade: 0.6,
};

/** Evolutionsstufen. `min` ist die Masse, ab der die Stufe erreicht wird. */
export const STAGES = [
  { key: 'asteroid', name: 'Asteroid', min: 0,    line: 'Klein, kantig, hungrig.' },
  { key: 'moon',     name: 'Mond',     min: 60,   line: 'Jetzt mit Kratern. Und Ambitionen.' },
  { key: 'planet',   name: 'Planet',   min: 170,  line: 'Eigene Atmosphäre, eigenes Wetter, eigene Regeln.' },
  { key: 'giant',    name: 'Gasriese', min: 450,  line: 'Hauptsächlich heiße Luft. Aber sehr viel davon.' },
  { key: 'star',     name: 'Stern',    min: 1100, line: 'Ab jetzt drehen sich die anderen um dich.' },
];
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
  speedPerStage: 16,
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
  count: 1800,
  mass: 1,
  radius: 4,
  clusterMin: 4,
  clusterMax: 14,
  clusterSpread: 80,
  clustersPerSecond: 4,
  drift: 10,
  drag: 1.4,
  pullFactor: 1.5,        // Einfallgeschwindigkeit als Vielfaches des Gravitationsradius pro Sekunde
  swirl: 0.6,             // tangentialer Anteil → Spiralen
  response: 6,
  fadeIn: 0.5,
  dropImmune: 1.2,        // eigener Boost-Staub wird nicht sofort wieder eingesaugt
};

export const ASTEROID = {
  count: 130,
  massMin: 3,
  massMax: 9,
  radiusK: 3.6,           // r = radiusK * sqrt(Masse)
  drift: 26,
  drag: 0.35,
  spawnPerSecond: 2,
  pullFactor: 0.8,
  variants: 12,
};

export const COMET = {
  max: 3,
  intervalMin: 5,
  intervalMax: 11,
  firstDelay: 4,
  speedMin: 360,
  speedMax: 500,
  reward: 24,
  mass: 2,
  radius: 7,
  gravity: 26000,         // echte 1/r²-Ablenkung durch Gravitationsbrunnen
};

export const BLACK_HOLE = {
  max: 2,
  firstDelay: 45,
  intervalMin: 40,
  intervalMax: 80,
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
  count: 20,
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
