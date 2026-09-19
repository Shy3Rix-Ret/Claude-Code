// Alles bleibt auf dem Gerät. Kein Konto, kein Server, keine Analyse — genau
// das ist in der Zusammenfassung als größte Stärke der App genannt, und es
// wäre albern, das beim Nachbau aufzugeben.

import { serializeStroke, deserializeStroke } from './state.js';

const KEY = 'pmt.session.v1';
const FORMAT = 'play_music_theory/1';

export function saveSession(store) {
  try {
    const snap = store.snapshot();
    localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, saved: Date.now(), doc: snap }));
    return true;
  } catch {
    // Privates Fenster, volles Kontingent — kein Grund, die App anzuhalten.
    return false;
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.format !== FORMAT) return null;
    return hydrate(parsed.doc);
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
}

export function toFile(store) {
  const snap = store.snapshot();
  return new Blob(
    [JSON.stringify({ format: FORMAT, app: 'play_music_theory', exported: new Date().toISOString(), doc: snap }, null, 1)],
    { type: 'application/json' },
  );
}

export async function fromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (parsed?.format !== FORMAT || !parsed.doc) throw new Error('Das ist keine play_music_theory-Datei.');
  return hydrate(parsed.doc);
}

function hydrate(doc) {
  return { ...doc, strokes: (doc.strokes ?? []).map(deserializeStroke) };
}

export { serializeStroke };
