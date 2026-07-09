import { useMemo } from "react";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { DocumentProvider } from "@/ui/hooks/DocumentContext";
import { Shell } from "@/ui/shell/Shell";
import { EditorState } from "@/ui/state/EditorState";

/** Composition root: one Document, one EditorState, the shell. */
export function App() {
  const { doc, editor } = useMemo(() => {
    const doc = new Document();
    // seed scene: a cube, pre-selected, with clean history
    const seed = new CreateNodeCommand("mesh", "Cube", null, undefined, {
      primitive: defaultPrimitive("cube"),
    });
    doc.history.run(seed);
    doc.history.clear();
    doc.selection.selectObjects([seed.nodeId]);
    return { doc, editor: new EditorState() };
  }, []);

  return (
    <DocumentProvider value={doc}>
      <Shell doc={doc} editor={editor} />
    </DocumentProvider>
  );
}
