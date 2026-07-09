import { useMemo } from "react";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { setAppDocument } from "@/ui/hooks/doc/document";
import { Shell } from "@/ui/shell/Shell";

/** Composition root: one Document installed into the jotai store, the shell. */
export function App() {
  const doc = useMemo(() => {
    const doc = new Document();
    // seed scene: a cube, pre-selected, with clean history
    const seed = new CreateNodeCommand("mesh", "Cube", null, undefined, {
      primitive: defaultPrimitive("cube"),
    });
    doc.history.run(seed);
    doc.history.clear();
    doc.selection.selectObjects([seed.nodeId]);
    setAppDocument(doc);
    return doc;
  }, []);

  return <Shell doc={doc} />;
}
