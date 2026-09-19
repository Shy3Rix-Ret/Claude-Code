// Web MIDI. Optional in jeder Hinsicht: die API fehlt in Safari komplett, und
// die App darf davon nichts merken (§ "MIDI-Keyboard-Eingabe kann optional die
// Schleife ergänzen").

export function createMidiInput({ onNote, onStatus }) {
  let access = null;
  let enabled = false;

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      onStatus?.({ ok: false, message: 'Dieser Browser kennt Web MIDI nicht (Safari und Firefox z.B.).' });
      return false;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      bind();
      access.onstatechange = bind;
      enabled = true;
      return true;
    } catch (err) {
      onStatus?.({ ok: false, message: `MIDI wurde abgelehnt: ${err?.message ?? err}` });
      return false;
    }
  }

  function bind() {
    if (!access) return;
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = handle;
      names.push(input.name || 'Gerät');
    }
    onStatus?.({
      ok: true,
      devices: names,
      message: names.length ? `MIDI: ${names.join(', ')}` : 'MIDI aktiv, aber kein Gerät gefunden.',
    });
  }

  function handle(ev) {
    if (!enabled) return;
    const [status, data1, data2] = ev.data;
    const type = status & 0xf0;
    if (type === 0x90 && data2 > 0) onNote?.({ midi: data1, velocity: data2 / 127, on: true });
    else if (type === 0x80 || (type === 0x90 && data2 === 0)) onNote?.({ midi: data1, velocity: 0, on: false });
  }

  return {
    connect,
    get enabled() { return enabled; },
    disconnect() {
      enabled = false;
      if (!access) return;
      for (const input of access.inputs.values()) input.onmidimessage = null;
    },
  };
}
