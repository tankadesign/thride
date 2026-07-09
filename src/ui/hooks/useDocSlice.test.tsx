// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { act, render, screen } from "@testing-library/react";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { useDocSlice } from "./useDocSlice";

let sceneRenders = 0;
let materialRenders = 0;

function ScenePanel({ doc }: { doc: Document }) {
  useDocSlice("scene", doc);
  sceneRenders++;
  return <div data-testid="scene">{doc.scene.size}</div>;
}

function MaterialsPanel({ doc }: { doc: Document }) {
  useDocSlice("materials", doc);
  materialRenders++;
  return <div data-testid="materials" />;
}

describe("useDocSlice", () => {
  it("re-renders only panels subscribed to the bumped slice", () => {
    const doc = new Document();
    render(
      <>
        <ScenePanel doc={doc} />
        <MaterialsPanel doc={doc} />
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
