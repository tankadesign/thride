import { useEffect, useRef } from "react";
import type {
  ComponentMode,
  NodeKind,
  PlanarReflectionDTO,
  TransformDTO,
  Uuid,
} from "@/types/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import type { LightDataDTO } from "@/types/core/light";
import { type CameraDataDTO, defaultCameraData } from "@/types/core/camera";
import type { GeneratorDescriptor } from "@/generators/graph";
import type { SplineData, SplinePrimitive } from "@/types/geometry/spline";
import {
  RenameNodeCommand,
  SetFlagsCommand,
  SetTransformCommand,
} from "@/core/history/commands/scene";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { Field, Section, VecField } from "@/ui/widgets/inspector";
import { ComponentSection, SplineComponentSection } from "./attributes/components";
import { GeneratorParams } from "./attributes/generator";
import {
  MeshInfo,
  PrimitiveParams,
  SplinePrimitiveParams,
  SplineSection,
} from "./attributes/geometry";
import { LightParams, TargetSelector } from "./attributes/light";
import { CameraParams } from "./attributes/camera";
import { MaterialSelector, PlanarReflectionSection } from "./attributes/shading";

const MODE_TITLE: Record<ComponentMode, string> = {
  point: "Points",
  edge: "Edges",
  polygon: "Polygons",
};

/** Node kinds that render as triangle meshes and can take a library material. */
const MATERIAL_CAPABLE = new Set<NodeKind>(["mesh", "generator"]);

/**
 * Attributes/inspector. Object mode shows the node's settings; component
 * modes lock the panel to that mode's selection (XYZ/WHD only) and retitle
 * the dock tab to Points / Edges / Polygons. Every section renders through
 * the shared `Field`/`VecField`/`Section` primitives (`ui/widgets/inspector`).
 */
export function AttributesPanel({ panelApi }: { panelApi?: { setTitle(title: string): void } }) {
  const doc = useDocument();
  useSliceVersion("scene");
  const { active, editMode } = useSelectionInfo();
  const componentMode =
    editMode === "point" || editMode === "edge" || editMode === "polygon" ? editMode : null;
  const title = componentMode ? MODE_TITLE[componentMode] : "Attributes";
  useEffect(() => {
    panelApi?.setTitle(title);
  }, [panelApi, title]);

  if (componentMode) {
    const node = active && doc.scene.has(active) ? doc.scene.mustGet(active) : null;
    const meshRef = node?.data?.mesh as { id: Uuid } | undefined;
    // a spline in point mode edits its own points (no kernel mesh), the same
    // numeric component editing as meshes get
    const splineData =
      node?.kind === "spline" ? (node.data?.spline as SplineData | undefined) : undefined;
    if (active && meshRef) {
      return (
        <div className="h-full overflow-auto bg-base-100 text-xs">
          <ComponentSection id={active} meshId={meshRef.id} mode={componentMode} />
        </div>
      );
    }
    if (active && componentMode === "point" && splineData) {
      return (
        <div className="h-full overflow-auto bg-base-100 text-xs">
          <SplineComponentSection id={active} />
        </div>
      );
    }
    return (
      <div className="h-full bg-base-100 p-3 text-xs opacity-50">
        No editable component selected
      </div>
    );
  }

  if (!active || !doc.scene.has(active)) {
    return <div className="h-full bg-base-100 p-3 text-xs opacity-50">Nothing selected</div>;
  }
  return <NodeAttributes key={active} id={active} />;
}

function NodeAttributes({ id }: { id: Uuid }) {
  const doc = useDocument();
  const node = doc.scene.mustGet(id);
  const scrubbing = useRef(false);

  /** NumberDrag scrubs stream (committed=false…true); route through a session. */
  const setTransform = (mutate: (t: TransformDTO) => void, committed: boolean) => {
    if (!scrubbing.current) {
      doc.sessions.start(new TransformDragSession([id]));
      scrubbing.current = true;
    }
    const t = structuredClone(doc.scene.mustGet(id).transform);
    mutate(t);
    doc.sessions.update(new Map([[id, t]]));
    if (committed) {
      doc.sessions.commit();
      scrubbing.current = false;
    }
  };

  /** One undo step returning the whole PSR group to identity. */
  const resetTransform = () => {
    const after: TransformDTO = {
      ...structuredClone(node.transform),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    doc.history.run(new SetTransformCommand(id, after));
  };

  const t = node.transform;
  const prim = node.data?.primitive as PrimitiveDescriptor | undefined;
  const splinePrim = node.data?.splinePrimitive as SplinePrimitive | undefined;
  const spline = node.data?.spline as SplineData | undefined;
  const meshRef = node.data?.mesh as { id: Uuid } | undefined;
  const light = node.data?.light as LightDataDTO | undefined;
  const camera = node.data?.camera as CameraDataDTO | undefined;
  const generator = node.data?.generator as GeneratorDescriptor | undefined;

  return (
    <div className="h-full overflow-auto bg-base-100 text-xs py-2">
      <Section title="Object">
        <Field label="Name">
          <input
            key={node.name}
            className="input input-sm w-full transition-colors ease-out duration-300 focus:input-primary outline-none focus:text-primary selection:bg-primary/30"
            defaultValue={node.name}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== node.name) {
                doc.history.run(new RenameNodeCommand(id, e.target.value));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
        </Field>
        <Field label="Visible">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={node.visible}
            onChange={(e) =>
              doc.history.run(new SetFlagsCommand(id, { visible: e.target.checked }))
            }
          />
        </Field>
      </Section>

      <Section title="Transform" onReset={resetTransform}>
        <VecField
          label="Position"
          values={t.position}
          onChange={(i, v, committed) =>
            setTransform((tt) => {
              tt.position[i] = v;
            }, committed)
          }
        />
        <VecField
          label="Rotation"
          values={t.rotation}
          deg
          onChange={(i, v, committed) =>
            setTransform((tt) => {
              tt.rotation[i] = v;
            }, committed)
          }
        />
        <VecField
          label="Scale"
          values={t.scale}
          step={0.005}
          onChange={(i, v, committed) =>
            setTransform((tt) => {
              tt.scale[i] = v;
            }, committed)
          }
        />
      </Section>

      {spline ? <SplineSection id={id} data={spline} /> : null}
      {prim ? <PrimitiveParams id={id} prim={prim} /> : null}
      {splinePrim ? <SplinePrimitiveParams id={id} prim={splinePrim} /> : null}
      {generator ? <GeneratorParams id={id} gen={generator} /> : null}
      {meshRef ? <MeshInfo meshId={meshRef.id} /> : null}
      {MATERIAL_CAPABLE.has(node.kind) ? <MaterialSelector id={id} /> : null}
      {MATERIAL_CAPABLE.has(node.kind) ? (
        <PlanarReflectionSection
          id={id}
          planar={node.data?.planar as PlanarReflectionDTO | undefined}
        />
      ) : null}
      {light ? <LightParams id={id} light={light} /> : null}
      {node.kind === "camera" ? (
        <CameraParams id={id} camera={camera ?? defaultCameraData()} />
      ) : null}
      {node.kind === "light" || node.kind === "camera" ? <TargetSelector id={id} /> : null}
    </div>
  );
}
