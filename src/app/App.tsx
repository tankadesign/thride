import { useEffect, useMemo } from "react";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { loadLocalProject, startAutosave } from "@/io/storage/local";
import { setAppDocument } from "@/ui/hooks/doc/document";
import { Shell } from "@/ui/shell/Shell";

/** Composition root: one Document installed into the jotai store, the shell. */
export function App() {
  const doc = useMemo(() => {
    const doc = new Document();
    const saved = loadLocalProject();
    if (saved) {
      // restore the last autosaved project (survives a refresh/crash)
      doc.loadDTO(saved);
    } else {
      // first run: seed scene with a cube, pre-selected, clean history
      const seed = new CreateNodeCommand("mesh", "Cube", null, undefined, {
        primitive: defaultPrimitive("cube"),
      });
      doc.history.run(seed);
      doc.history.clear();
      doc.selection.selectObjects([seed.nodeId]);
    }
    setAppDocument(doc);
    return doc;
  }, []);

  useEffect(() => startAutosave(doc), [doc]);

  return <Shell doc={doc} />;
}
