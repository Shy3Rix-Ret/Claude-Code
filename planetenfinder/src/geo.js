/**
 * Where the observer is, and how that survives a reload.
 *
 * A wrong position of a few kilometres is invisible for the planets and worth
 * up to a degree for the Moon, so GPS is preferred, a manual entry is kept as
 * a fallback, and the last known fix is remembered. Nothing is ever sent
 * anywhere — the coordinates stay in localStorage on the device.
 */

const KEY = 'planetenfinder.settings.v1';

export const DEFAULT_SITE = {
  lat: 52.5200,
  lon: 13.4050,
  elevation: 34,
  label: 'Berlin (Voreinstellung)',
  source: 'default',
  accuracy: null,
};

export const PRESETS = [
  { label: 'Berlin', lat: 52.5200, lon: 13.4050, elevation: 34 },
  { label: 'Hamburg', lat: 53.5511, lon: 9.9937, elevation: 6 },
  { label: 'München', lat: 48.1372, lon: 11.5756, elevation: 519 },
  { label: 'Köln', lat: 50.9375, lon: 6.9603, elevation: 53 },
  { label: 'Frankfurt', lat: 50.1109, lon: 8.6821, elevation: 112 },
  { label: 'Wien', lat: 48.2082, lon: 16.3738, elevation: 171 },
  { label: 'Zürich', lat: 47.3769, lon: 8.5417, elevation: 408 },
  { label: 'Istanbul', lat: 41.0082, lon: 28.9784, elevation: 39 },
];

const DEFAULT_SETTINGS = {
  site: DEFAULT_SITE,
  headingOffset: 0,
  fov: 62,
  camera: false,
  stars: true,
  constellations: true,
  grid: true,
  labels: true,
  nightMode: false,
  smoothing: true,
  levelHorizon: true,
  belowHorizon: true,
  mapHeadingUp: false,
  ecliptic: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed, site: { ...DEFAULT_SITE, ...(parsed.site || {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode, quota, an embedded frame with storage blocked — the app
    // works fine without persistence, it just forgets.
  }
}

/** One-shot GPS fix. Resolves to a site, rejects with a readable reason. */
export function locate({ timeout = 15000, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Dieses Gerät meldet keine Standortdaten.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        elevation: pos.coords.altitude ?? 0,
        accuracy: pos.coords.accuracy ?? null,
        label: 'GPS-Standort',
        source: 'gps',
      }),
      (err) => {
        const reasons = {
          1: 'Standortzugriff abgelehnt. Du kannst den Ort auch von Hand eintragen.',
          2: 'Kein Standort verfügbar (kein GPS-Empfang?). Bitte von Hand eintragen.',
          3: 'Die Standortsuche hat zu lange gedauert. Bitte noch einmal versuchen.',
        };
        reject(new Error(reasons[err.code] || 'Standort konnte nicht ermittelt werden.'));
      },
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 60000 },
    );
  });
}

/** 52.5200° N, 13.4050° O — the form people can read back off a map. */
export function formatCoords(site) {
  const ns = site.lat >= 0 ? 'N' : 'S';
  const ew = site.lon >= 0 ? 'O' : 'W';
  return `${Math.abs(site.lat).toFixed(4)}° ${ns}, ${Math.abs(site.lon).toFixed(4)}° ${ew}`;
}

export function parseCoordinate(text) {
  const value = Number(String(text).replace(',', '.').trim());
  return Number.isFinite(value) ? value : null;
}
