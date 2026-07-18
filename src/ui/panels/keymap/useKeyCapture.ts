import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { chordFromEvent, formatChord, parseChord } from "@/core/keymap/chord";
import { activeKeyPresetAtom, bindKey, keyCaptureActiveAtom } from "@/ui/hooks/editor/keymap";

interface Conflict {
  chord: string;
  command: string;
}

/**
 * Single-slot key recorder for the bindings panel. While a command is recording
 * it owns the keyboard (capture-phase listener + `keyCaptureActiveAtom`), so no
 * app shortcut fires. Escape cancels; a chord already bound elsewhere surfaces a
 * conflict the caller can resolve (replace) or dismiss.
 */
export function useKeyCapture(presetId: string) {
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const setCaptureActive = useSetAtom(keyCaptureActiveAtom);
  const preset = useAtomValue(activeKeyPresetAtom);

  const stop = () => {
    setRecordingCommand(null);
    setConflict(null);
    setCaptureActive(false);
  };

  const start = (command: string) => {
    setConflict(null);
    setRecordingCommand(command);
    setCaptureActive(true);
  };

  useEffect(() => {
    if (!recordingCommand) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stop();
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return; // bare modifier — wait for the actual key
      const canon = formatChord(chord);
      const clash = preset.keys.find(
        (k) => formatChord(parseChord(k.chord)) === canon && k.command !== recordingCommand,
      );
      if (clash) {
        setConflict({ chord: canon, command: clash.command });
        return;
      }
      bindKey(presetId, recordingCommand, canon);
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop is stable enough; re-arm only on command/preset change
  }, [recordingCommand, presetId, preset]);

  const replaceConflict = () => {
    if (conflict && recordingCommand) {
      bindKey(presetId, recordingCommand, conflict.chord, true);
      stop();
    }
  };

  return { recordingCommand, conflict, start, stop, replaceConflict };
}
