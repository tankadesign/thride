import { atom, useAtomValue } from "jotai";
import type { Uuid } from "@/types/core";
import type { ViewportSettingsDTO } from "@/types/editor";
import { defaultViewportSettings } from "@/types/editor";
import { Document } from "@/core";
import { uuidv7 } from "@/core/ids/uuid";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import {
  hydrateProjectRecord,
  loadProjectRecord,
  migrateLegacyAutosave,
  projectRecordOf,
  releaseProjectMeshes,
  saveProjectRecord,
} from "@/io/storage/projectStore";
import {
  applyViewportSettings,
  captureViewportSettings,
  subscribeViewportSettings,
} from "@/ui/hooks/editor/viewport";
import { appStore, docAtom } from "./document";

/**
 * Multi-project workspace: several projects open at once as tabs; the
 * active one is installed into docAtom (everything downstream — shell,
 * panels, viewport — keys off that). Scene data persists per project in
 * IndexedDB; which tabs are open is UI state in localStorage (like the
 * dock layout). Closing a tab keeps the stored record.
 */

export interface ProjectHandle {
  id: Uuid;
  name: string;
  doc: Document;
  /** Live per-project viewport settings; installed into the atoms when active. */
  viewport: ViewportSettingsDTO;
}

export const openProjectsAtom = atom<ProjectHandle[]>([]);
export const activeProjectIdAtom = atom<Uuid | null>(null);

export function useProjects() {
  return {
    projects: useAtomValue(openProjectsAtom),
    activeId: useAtomValue(activeProjectIdAtom),
  };
}

// ---- workspace session state (which tabs are open) --------------------------

const WORKSPACE_KEY = "thride:workspace:v1";
const AUTOSAVE_DEBOUNCE_MS = 400;

interface WorkspaceState {
  openIds: Uuid[];
  activeId: Uuid | null;
}

function readWorkspace(): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceState;
    return Array.isArray(parsed.openIds) ? parsed : null;
  } catch {
    return null;
  }
}

function persistWorkspace(): void {
  try {
    const openIds = appStore.get(openProjectsAtom).map((p) => p.id);
    const activeId = appStore.get(activeProjectIdAtom);
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ openIds, activeId }));
  } catch {
    // best-effort session state
  }
}

// ---- per-project autosave (debounced IndexedDB writes) ----------------------

const autosaves = new Map<Uuid, { stop: () => void; flush: () => void; schedule: () => void }>();

function startAutosave(p: ProjectHandle): void {
  if (autosaves.has(p.id)) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    // spread the pure record and attach UI state at the call site so io/ never
    // reads viewport atoms; p.viewport is kept current by the viewport sub
    void saveProjectRecord({ ...projectRecordOf(p.id, p.name, p.doc), viewport: p.viewport });
  };
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write();
    }, AUTOSAVE_DEBOUNCE_MS);
  };
  // scene edits, material-library edits, AND viewport-setting changes all drive
  // the same debounced write (a pure material edit bumps only the material slice)
  const unsubs = [
    p.doc.subscribeSlice("scene", schedule),
    p.doc.subscribeSlice("materials", schedule),
    p.doc.subscribeSlice("settings", schedule), // environment / dome light edits
  ];
  autosaves.set(p.id, {
    flush: write,
    schedule,
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      for (const u of unsubs) u();
      autosaves.delete(p.id);
    },
  });
}

function flushAll(): void {
  for (const a of autosaves.values()) a.flush();
}

// ---- open/create/switch/close ------------------------------------------------

function installActive(id: Uuid | null): void {
  appStore.set(activeProjectIdAtom, id);
  const active = appStore.get(openProjectsAtom).find((p) => p.id === id);
  appStore.set(docAtom, active ? active.doc : null);
  // load this project's viewport settings into the (global) atoms. The viewport
  // sub then writes the same values back to active.viewport — idempotent, so no
  // suppression is needed. Active id is set first so that write targets `active`.
  applyViewportSettings(active?.viewport);
  persistWorkspace();
}

/**
 * Mirror viewport-setting atom changes back onto the active project handle and
 * schedule its autosave (scene edits alone would never persist a grid/shading
 * toggle). Installed once from bootWorkspace, after the initial activate.
 */
function startViewportSync(): void {
  subscribeViewportSettings(() => {
    const id = appStore.get(activeProjectIdAtom);
    if (!id) return;
    const handle = appStore.get(openProjectsAtom).find((p) => p.id === id);
    if (!handle) return;
    handle.viewport = captureViewportSettings();
    autosaves.get(id)?.schedule();
  });
}

function openHandle(handle: ProjectHandle, activate: boolean): void {
  appStore.set(openProjectsAtom, [...appStore.get(openProjectsAtom), handle]);
  startAutosave(handle);
  if (activate) installActive(handle.id);
  else persistWorkspace();
}

function seededDocument(): Document {
  const doc = new Document();
  const seed = new CreateNodeCommand("mesh", "Cube", null, undefined, {
    primitive: defaultPrimitive("cube"),
  });
  doc.history.run(seed);
  doc.history.clear();
  doc.selection.selectObjects([seed.nodeId]);
  return doc;
}

function untitledName(): string {
  const names = new Set(appStore.get(openProjectsAtom).map((p) => p.name));
  if (!names.has("Untitled")) return "Untitled";
  let n = 2;
  while (names.has(`Untitled ${n}`)) n++;
  return `Untitled ${n}`;
}

/** New seeded project: stored immediately, opened as the active tab. */
export async function createProject(): Promise<void> {
  const handle: ProjectHandle = {
    id: uuidv7(),
    name: untitledName(),
    doc: seededDocument(),
    viewport: defaultViewportSettings(),
  };
  await saveProjectRecord({
    ...projectRecordOf(handle.id, handle.name, handle.doc),
    viewport: handle.viewport,
  });
  openHandle(handle, true);
}

export function switchProject(id: Uuid): void {
  if (appStore.get(activeProjectIdAtom) === id) return;
  if (!appStore.get(openProjectsAtom).some((p) => p.id === id)) return;
  installActive(id);
}

/** Rename a project (tab double-click). Persists to IndexedDB immediately. */
export function renameProject(id: Uuid, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const open = appStore.get(openProjectsAtom);
  const handle = open.find((p) => p.id === id);
  if (!handle || handle.name === trimmed) return;
  // mutate in place: the autosave closure holds this handle and reads `name`
  // at write time; the fresh array identity re-renders the tabs
  handle.name = trimmed;
  appStore.set(openProjectsAtom, [...open]);
  autosaves.get(id)?.flush();
}

/** Close a tab (the stored record stays). The last tab cannot close. */
export function closeProject(id: Uuid): void {
  const open = appStore.get(openProjectsAtom);
  if (open.length <= 1) return;
  const index = open.findIndex((p) => p.id === id);
  if (index === -1) return;
  const closing = open[index]!;
  autosaves.get(id)?.flush();
  autosaves.get(id)?.stop();
  const rest = open.filter((p) => p.id !== id);
  appStore.set(openProjectsAtom, rest);
  releaseProjectMeshes(closing.doc.toDTO());
  if (appStore.get(activeProjectIdAtom) === id) {
    installActive((rest[index] ?? rest[index - 1] ?? rest[0])!.id);
  } else {
    persistWorkspace();
  }
}

// ---- boot --------------------------------------------------------------------

let bootPromise: Promise<void> | null = null;

/**
 * Restore the last session's open tabs from IndexedDB (migrating any legacy
 * localStorage autosave into a project first); start with a fresh seeded
 * project when nothing is stored. Idempotent.
 */
export function bootWorkspace(): Promise<void> {
  bootPromise ??= (async () => {
    const session = readWorkspace();
    const handles: ProjectHandle[] = [];
    for (const id of session?.openIds ?? []) {
      const record = await loadProjectRecord(id);
      if (!record) continue;
      const dto = hydrateProjectRecord(record);
      if (!dto) continue;
      const doc = new Document();
      doc.loadDTO(dto);
      handles.push({
        id: record.id,
        name: record.name,
        doc,
        viewport: record.viewport ?? defaultViewportSettings(),
      });
    }
    if (handles.length === 0) {
      const legacy = migrateLegacyAutosave(uuidv7(), "Untitled");
      if (legacy) {
        const dto = hydrateProjectRecord(legacy);
        if (dto) {
          await saveProjectRecord(legacy);
          const doc = new Document();
          doc.loadDTO(dto);
          handles.push({
            id: legacy.id,
            name: legacy.name,
            doc,
            viewport: legacy.viewport ?? defaultViewportSettings(),
          });
        }
      }
    }
    if (handles.length === 0) {
      const handle: ProjectHandle = {
        id: uuidv7(),
        name: "Untitled",
        doc: seededDocument(),
        viewport: defaultViewportSettings(),
      };
      await saveProjectRecord({
        ...projectRecordOf(handle.id, handle.name, handle.doc),
        viewport: handle.viewport,
      });
      handles.push(handle);
    }
    for (const h of handles) openHandle(h, false);
    const activeId =
      session?.activeId && handles.some((h) => h.id === session.activeId)
        ? session.activeId
        : handles[0]!.id;
    installActive(activeId);
    // start the viewport sub AFTER the initial activate so boot's own
    // applyViewportSettings doesn't schedule a redundant first save
    startViewportSync();
    window.addEventListener("beforeunload", flushAll);
  })();
  return bootPromise;
}
