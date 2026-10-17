/**
 * localStorage mit Netz und doppeltem Boden: Im privaten Modus, bei
 * blockierten Website-Daten oder in eingebetteten Ansichten kann jeder
 * Zugriff werfen. Das Spiel läuft dann einfach ohne Speichern weiter.
 */
const PREFIX = 'orbit-eater:';

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Speichern nicht möglich — kein Grund, das Spiel zu stören.
    }
  },
};
