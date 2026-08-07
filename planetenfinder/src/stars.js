/**
 * A small bright-star catalogue, purely as scenery.
 *
 * The planets are the point of the app; the stars are here so that what you
 * see through the phone matches what you see over the top of it. Roughly the
 * naked-eye sky down to magnitude 2.5, plus the stars that carry the figures
 * people actually recognise.
 *
 * Positions are J2000 (RA in hours, Dec in degrees).
 */

// name, RA hours, Dec deg, magnitude
const CATALOGUE = [
  ['Sirius', 6.752, -16.716, -1.46],
  ['Canopus', 6.399, -52.696, -0.72],
  ['Rigil Kentaurus', 14.660, -60.834, -0.27],
  ['Arktur', 14.261, 19.182, -0.05],
  ['Wega', 18.615, 38.784, 0.03],
  ['Capella', 5.278, 45.998, 0.08],
  ['Rigel', 5.242, -8.202, 0.12],
  ['Prokyon', 7.655, 5.225, 0.34],
  ['Achernar', 1.629, -57.237, 0.46],
  ['Beteigeuze', 5.919, 7.407, 0.50],
  ['Hadar', 14.064, -60.373, 0.61],
  ['Altair', 19.846, 8.868, 0.77],
  ['Acrux', 12.443, -63.099, 0.77],
  ['Aldebaran', 4.599, 16.509, 0.85],
  ['Antares', 16.490, -26.432, 1.09],
  ['Spica', 13.420, -11.161, 1.04],
  ['Pollux', 7.755, 28.026, 1.14],
  ['Fomalhaut', 22.961, -29.622, 1.16],
  ['Deneb', 20.690, 45.280, 1.25],
  ['Mimosa', 12.795, -59.689, 1.25],
  ['Regulus', 10.140, 11.967, 1.35],
  ['Adhara', 6.977, -28.972, 1.50],
  ['Castor', 7.577, 31.888, 1.58],
  ['Gacrux', 12.519, -57.113, 1.63],
  ['Shaula', 17.560, -37.104, 1.62],
  ['Bellatrix', 5.418, 6.350, 1.64],
  ['Elnath', 5.438, 28.608, 1.65],
  ['Miaplacidus', 9.220, -69.717, 1.67],
  ['Alnilam', 5.604, -1.202, 1.69],
  ['Alnitak', 5.679, -1.943, 1.74],
  ['Alioth', 12.900, 55.960, 1.76],
  ['Dubhe', 11.062, 61.751, 1.79],
  ['Mintaka', 5.533, -0.299, 2.25],
  ['Mirfak', 3.405, 49.861, 1.79],
  ['Wezen', 7.140, -26.393, 1.83],
  ['Sargas', 17.622, -42.998, 1.86],
  ['Kaus Australis', 18.403, -34.385, 1.85],
  ['Avior', 8.375, -59.510, 1.86],
  ['Alkaid', 13.792, 49.313, 1.85],
  ['Menkalinan', 5.992, 44.947, 1.90],
  ['Atria', 16.811, -69.028, 1.91],
  ['Alhena', 6.629, 16.399, 1.93],
  ['Peacock', 20.427, -56.735, 1.94],
  ['Polaris', 2.530, 89.264, 1.98],
  ['Mirzam', 6.378, -17.956, 1.98],
  ['Alphard', 9.460, -8.659, 1.98],
  ['Algieba', 10.333, 19.841, 2.08],
  ['Hamal', 2.120, 23.462, 2.00],
  ['Diphda', 0.726, -17.987, 2.04],
  ['Nunki', 18.921, -26.297, 2.05],
  ['Menkent', 14.111, -36.370, 2.06],
  ['Alpheratz', 0.140, 29.091, 2.06],
  ['Mirach', 1.162, 35.621, 2.07],
  ['Rasalhague', 17.582, 12.560, 2.08],
  ['Kochab', 14.845, 74.156, 2.08],
  ['Saiph', 5.796, -9.670, 2.06],
  ['Denebola', 11.818, 14.572, 2.14],
  ['Algol', 3.136, 40.956, 2.12],
  ['Merak', 11.031, 56.382, 2.37],
  ['Phecda', 11.897, 53.695, 2.44],
  ['Megrez', 12.257, 57.033, 3.31],
  ['Mizar', 13.399, 54.925, 2.23],
  ['Izar', 14.750, 27.074, 2.35],
  ['Enif', 21.736, 9.875, 2.38],
  ['Markab', 23.079, 15.205, 2.49],
  ['Scheat', 23.063, 28.083, 2.42],
  ['Algenib', 0.221, 15.184, 2.83],
  ['Schedar', 0.675, 56.537, 2.23],
  ['Caph', 0.153, 59.150, 2.27],
  ['Tsih', 0.945, 60.717, 2.47],
  ['Ruchbah', 1.430, 60.235, 2.68],
  ['Segin', 1.906, 63.670, 3.35],
  ['Sadr', 20.371, 40.257, 2.23],
  ['Albireo', 19.512, 27.960, 3.18],
  ['Gienah Cygni', 20.770, 33.970, 2.48],
  ['Fawaris', 19.750, 45.131, 2.87],
  ['Dschubba', 16.005, -22.622, 2.29],
  ['Acrab', 16.090, -19.805, 2.62],
  ['Lesath', 17.513, -37.296, 2.69],
  ['Kaus Media', 18.350, -29.828, 2.70],
  ['Ascella', 19.043, -29.880, 2.60],
  ['Alderamin', 21.310, 62.586, 2.45],
  ['Eltanin', 17.943, 51.489, 2.23],
  ['Vindemiatrix', 13.036, 10.959, 2.83],
  ['Zosma', 11.235, 20.524, 2.56],
  ['Alnair', 22.137, -46.961, 1.74],
  ['Gamma Vel', 8.158, -47.337, 1.78],
  ['Suhail', 9.133, -43.433, 2.21],
  ['Regor', 8.158, -47.337, 1.83],
];

/**
 * Spectral colours, for the realistic mode.
 *
 * These are real differences, not decoration: Beteigeuze and Antares are
 * visibly orange-red to the naked eye, Rigel and Spica are blue-white, and
 * seeing that in the app is half of learning to recognise them. Only stars
 * whose class is unambiguous are listed; the rest stay neutral white.
 */
const COLOURS = {
  O: '#c6d8ff', B: '#cfe0ff', A: '#e6eeff', F: '#fff4e4', G: '#ffedc4',
  K: '#ffcf9a', M: '#ffab74',
};

const CLASSES = {
  Sirius: 'A', Canopus: 'F', 'Rigil Kentaurus': 'G', Arktur: 'K', Wega: 'A',
  Capella: 'G', Rigel: 'B', Prokyon: 'F', Achernar: 'B', Beteigeuze: 'M',
  Hadar: 'B', Altair: 'A', Acrux: 'B', Aldebaran: 'K', Antares: 'M',
  Spica: 'B', Pollux: 'K', Fomalhaut: 'A', Deneb: 'A', Mimosa: 'B',
  Regulus: 'B', Adhara: 'B', Castor: 'A', Gacrux: 'M', Shaula: 'B',
  Bellatrix: 'B', Elnath: 'B', Miaplacidus: 'A', Alnilam: 'B', Alnitak: 'O',
  Mintaka: 'O', Alioth: 'A', Dubhe: 'K', Mirfak: 'F', Wezen: 'F',
  Sargas: 'F', 'Kaus Australis': 'B', Avior: 'K', Alkaid: 'B',
  Menkalinan: 'A', Atria: 'K', Alhena: 'A', Peacock: 'B', Polaris: 'F',
  Mirzam: 'B', Alphard: 'K', Algieba: 'K', Hamal: 'K', Diphda: 'K',
  Nunki: 'B', Menkent: 'K', Alpheratz: 'B', Mirach: 'M', Rasalhague: 'A',
  Kochab: 'K', Saiph: 'B', Denebola: 'A', Algol: 'B', Merak: 'A',
  Phecda: 'A', Megrez: 'A', Mizar: 'A', Izar: 'K', Enif: 'K',
  Markab: 'B', Scheat: 'M', Algenib: 'B', Schedar: 'K', Caph: 'F',
  Tsih: 'B', Ruchbah: 'A', Segin: 'B', Sadr: 'F', Albireo: 'K',
  'Gienah Cygni': 'K', Fawaris: 'B', Dschubba: 'B', Acrab: 'B', Lesath: 'B',
  'Kaus Media': 'K', Ascella: 'A', Alderamin: 'A', Eltanin: 'K',
  Vindemiatrix: 'G', Zosma: 'A', Alnair: 'B', 'Gamma Vel': 'O',
  Suhail: 'K', Regor: 'O',
};

export const STARS = CATALOGUE.map(([name, ra, dec, mag], i) => ({
  id: `star-${i}`, name, ra, dec, mag,
  colour: COLOURS[CLASSES[name]] || '#eef3ff',
}));

const byName = new Map(STARS.map((s) => [s.name, s]));

/** Figures worth drawing: the ones people point at and name. */
const FIGURES = {
  'Orion': [
    ['Beteigeuze', 'Alnitak'], ['Alnitak', 'Alnilam'], ['Alnilam', 'Mintaka'],
    ['Mintaka', 'Bellatrix'], ['Bellatrix', 'Beteigeuze'],
    ['Mintaka', 'Rigel'], ['Alnitak', 'Saiph'], ['Rigel', 'Saiph'],
  ],
  'Großer Wagen': [
    ['Dubhe', 'Merak'], ['Merak', 'Phecda'], ['Phecda', 'Megrez'],
    ['Megrez', 'Dubhe'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'], ['Mizar', 'Alkaid'],
  ],
  'Kassiopeia': [
    ['Caph', 'Schedar'], ['Schedar', 'Tsih'], ['Tsih', 'Ruchbah'], ['Ruchbah', 'Segin'],
  ],
  'Schwan': [
    ['Deneb', 'Sadr'], ['Sadr', 'Albireo'],
    ['Fawaris', 'Sadr'], ['Sadr', 'Gienah Cygni'],
  ],
  'Skorpion': [
    ['Dschubba', 'Acrab'], ['Dschubba', 'Antares'], ['Antares', 'Sargas'],
    ['Sargas', 'Shaula'], ['Shaula', 'Lesath'],
  ],
  'Kreuz des Südens': [
    ['Acrux', 'Gacrux'], ['Mimosa', 'Acrux'],
  ],
  'Löwe': [
    ['Regulus', 'Algieba'], ['Algieba', 'Zosma'], ['Zosma', 'Denebola'],
  ],
  'Zwillinge': [
    ['Castor', 'Pollux'], ['Pollux', 'Alhena'],
  ],
  'Pegasus': [
    ['Alpheratz', 'Scheat'], ['Scheat', 'Markab'],
    ['Markab', 'Algenib'], ['Algenib', 'Alpheratz'], ['Markab', 'Enif'],
  ],
};

/** Flattened to star pairs once, so the renderer only does geometry. */
export const CONSTELLATION_LINES = Object.entries(FIGURES).flatMap(([figure, pairs]) =>
  pairs
    .map(([a, b]) => ({ figure, a: byName.get(a), b: byName.get(b) }))
    .filter((l) => l.a && l.b),
);
