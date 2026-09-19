// Dateien herausgeben — in zwei Umgebungen, mit einem Aufruf.
//
// Im normalen Browser ist das ein <a download>. In einem eingebetteten
// claude.ai-Artifact ist genau das wirkungslos: der Rahmen unterbindet jeden
// Download, den die Seite selbst startet. Dort gibt es stattdessen die
// `downloads`-Fähigkeit, die den Betrachter fragt, bevor gespeichert wird.
//
// Deren Erweiterungsliste kennt weder .wav noch .mid. Ein ZIP kennt sie —
// also wandert Audio dort in einen Container, statt dass ein Knopf stumm
// bleibt. Kein Ratespiel: die Liste steht im Vertrag der Fähigkeit.

const ALLOWED = new Set([
  'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md',
  'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip',
]);

let pending = null;

/** @returns {Promise<object|null>} die Fähigkeit, oder null im echten Browser. */
export function downloadsCapability() {
  if (pending) return pending;
  pending = (async () => {
    try {
      return (await window.claude?.use?.('downloads')) ?? null;
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Läuft die Seite in einem Artifact-Rahmen? */
export const embedded = () => typeof window.claude?.use === 'function';

const extOf = (name) => (name.split('.').pop() || '').toLowerCase();

/**
 * @returns {Promise<{ok: boolean, how: 'link'|'saved'|'zip', name: string, reason?: string}>}
 */
export async function saveFile(blob, filename) {
  const cap = await downloadsCapability();

  if (!cap) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, how: 'link', name: filename };
  }

  let name = filename;
  let data = blob;
  let how = 'saved';
  if (!ALLOWED.has(extOf(filename))) {
    data = await makeZip([{ name: filename, blob }]);
    name = `${filename.replace(/\.[^.]+$/, '')}.zip`;
    how = 'zip';
  }

  try {
    await cap.save({ filename: name, data });
    return { ok: true, how, name };
  } catch (err) {
    return { ok: false, how, name, reason: explain(err) };
  }
}

function explain(err) {
  switch (err?.code) {
    case 'declined':        return 'Abgebrochen.';
    case 'rate_limited':    return 'Ein Speichern läuft schon — gleich noch einmal versuchen.';
    case 'too_large':       return 'Die Datei ist zu groß. Weniger Wiederholungen wählen.';
    case 'rejected_extension':
    case 'extension_not_enabled':
      return 'Dieses Dateiformat lässt der Viewer nicht zu.';
    default:                return err?.message || 'Speichern nicht möglich.';
  }
}

// ── ZIP, Methode „store" ────────────────────────────────────────────────────
// Ohne Komprimierung: eine WAV-Datei lässt sich ohnehin kaum packen, und ein
// Deflate-Encoder von Hand wäre viel Code für nichts.

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function makeZip(entries) {
  const enc = new TextEncoder();
  const files = [];
  for (const e of entries) {
    files.push({
      name: enc.encode(e.name),
      bytes: new Uint8Array(await e.blob.arrayBuffer()),
    });
  }

  const now = new Date();
  // MS-DOS-Zeitstempel: Sekunden in Zweierschritten, Jahr ab 1980.
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const crc = crc32(f.bytes);
    const head = new Uint8Array(30 + f.name.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);   // Signatur
    v.setUint16(4, 20, true);           // benötigte Version
    v.setUint16(6, 0x0800, true);       // Flag: Name ist UTF-8
    v.setUint16(8, 0, true);            // Methode: store
    v.setUint16(10, dosTime, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, f.bytes.length, true);
    v.setUint32(22, f.bytes.length, true);
    v.setUint16(26, f.name.length, true);
    head.set(f.name, 30);
    locals.push(head, f.bytes);

    const dir = new Uint8Array(46 + f.name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, 0, true);
    d.setUint16(12, dosTime, true);
    d.setUint16(14, dosDate, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, f.bytes.length, true);
    d.setUint32(24, f.bytes.length, true);
    d.setUint16(28, f.name.length, true);
    d.setUint32(42, offset, true);
    dir.set(f.name, 46);
    central.push(dir);

    offset += head.length + f.bytes.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);

  return new Blob([...locals, ...central, end], { type: 'application/zip' });
}
