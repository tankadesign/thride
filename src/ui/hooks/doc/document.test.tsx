// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { act, render, screen } from "@testing-library/react";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { setAppDocument, useDocument, useSliceVersion } from "./document";

let sceneRenders = 0;
let materialRenders = 0;

function ScenePanel() {
  const doc = useDocument();
  useSliceVersion("scene");
  sceneRenders++;
  return <div data-testid="scene">{doc.scene.size}</div>;
}

function MaterialsPanel() {
  useSliceVersion("materials");
  materialRenders++;
  return <div data-testid="materials" />;
}

describe("jotai document hooks", () => {
  it("re-renders only components subscribed to the bumped slice", () => {
    const doc = new Document();
    setAppDocument(doc);
    render(
      <>
        <ScenePanel />
        <MaterialsPanel />
      </>,
    );
    const sceneBefore = sceneRenders;
    const materialsBefore = materialRenders;

    act(() => {
      doc.history.run(new CreateNodeCommand("mesh", "Cube"));
    });

    expect(screen.getByTestId("scene").textContent).toBe("1");
    expect(sceneRenders).toBeGreaterThan(sceneBefore); // scene panel re-rendered
    expect(materialRenders).toBe(materialsBefore); // materials panel did NOT
  });
});
