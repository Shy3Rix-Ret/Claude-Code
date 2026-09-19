// AudioBuffer → WAV (16 bit PCM). Bewusst kein MediaRecorder: der nimmt in
// Echtzeit auf, liefert je nach Browser webm/ogg/mp4 statt wav und hängt am
// Ausgabegerät. Offline gerendert und selbst kodiert ist das Ergebnis exakt
// reproduzierbar und überall dieselbe Datei.

export function encodeWav(audioBuffer) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const frames = audioBuffer.length;
  const rate = audioBuffer.sampleRate;
  const blockAlign = channels * 2;
  const dataBytes = frames * blockAlign;

  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // Chunk-Länge
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = [];
  for (let c = 0; c < channels; c += 1) data.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      let s = data[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
