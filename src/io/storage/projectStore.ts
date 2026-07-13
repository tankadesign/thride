import type { Document } from "@/core";
import {
  FORMAT_VERSION,
  type TextureAssetDTO,
  type ThrideDocumentDTO,
  type Uuid,
} from "@/types/core";
import type { ViewportSettingsDTO } from "@/types/editor";
import { HEMesh, type HEMeshSnapshot } from "@/geometry/kernel/HEMesh";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { type PackedMesh, unpackMesh } from "./meshPack";
import { textureAssets, texturesOf } from "./textureAssets";

/**
 * IndexedDB project persistence (interim until the .thride package, H1).
 * One record per project — document DTO plus every referenced kernel mesh
 * as a structured-clone snapshot (typed arrays store natively; no base64).
 * If scenes ever grow to hundreds of MB, split into projects + objects
 * stores; a single record is fine at current scales.
 */

export interface ProjectRecord {
  id: Uuid;
  name: string;
  updatedAt: number;
  document: ThrideDocumentDTO;
  /** Kernel meshes referenced by nodes, keyed by mesh id. */
  meshes: Record<string, HEMeshSnapshot>;
  /**
   * Bitmap texture assets referenced by materials, keyed by asset id. Bytes
   * store natively via structured clone (no base64). Optional — records saved
   * before textures existed hydrate with none.
   */
  textures?: Record<string, TextureAssetDTO>;
  /**
   * Per-project viewport/UI settings (layout, pane cameras, per-pane display).
   * Optional — records saved before this existed hydrate to defaults. Kept
   * OUT of `document` so the DTO / GLTF export stay free of UI state.
   */
  viewport?: ViewportSettingsDTO;
}

export interface ProjectListing {
  id: Uuid;
  name: string;
  updatedAt: number;
}

const DB_NAME = "thride";
const DB_VERSION = 1;
const STORE = "projects";

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
  return dbPromise;
}

function requestDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

export async function saveProjectRecord(record: ProjectRecord): Promise<void> {
  const d = await db();
  await requestDone(d.transaction(STORE, "readwrite").objectStore(STORE).put(record));
}

export async function loadProjectRecord(id: Uuid): Promise<ProjectRecord | null> {
  const d = await db();
  const rec = await requestDone(d.transaction(STORE).objectStore(STORE).get(id));
  return (rec as ProjectRecord | undefined) ?? null;
}

export async function deleteProjectRecord(id: Uuid): Promise<void> {
  const d = await db();
  await requestDone(d.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

export async function listProjectRecords(): Promise<ProjectListing[]> {
  const d = await db();
  const all = (await requestDone(d.transaction(STORE).objectStore(STORE).getAll())) as
    | ProjectRecord[]
    | undefined;
  return (all ?? [])
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---- record ⇄ runtime ------------------------------------------------------

/** Snapshot an open document (+ its registry meshes) into a storable record. */
export function projectRecordOf(id: Uuid, name: string, doc: Document): ProjectRecord {
  const document = doc.toDTO();
  const meshes: Record<string, HEMeshSnapshot> = {};
  for (const node of document.nodes) {
    const ref = node.data?.mesh as { id: Uuid } | undefined;
    if (!ref?.id || meshes[ref.id]) continue;
    const mesh = meshRegistry.get(ref.id);
    if (mesh) meshes[ref.id] = mesh.snapshot();
  }
  const textures: Record<string, TextureAssetDTO> = {};
  for (const mat of document.materials ?? []) {
    for (const texId of texturesOf(mat)) {
      if (textures[texId]) continue;
      const asset = textureAssets.get(texId);
      if (asset) textures[texId] = asset;
    }
  }
  return { id, name, updatedAt: Date.now(), document, meshes, textures };
}

/**
 * Register a record's kernel meshes into the registry (fresh copies) and
 * validate the DTO. Corrupt mesh entries are dropped individually — the
 * node falls back to a placeholder instead of the project failing to open.
 */
export function hydrateProjectRecord(record: ProjectRecord): ThrideDocumentDTO | null {
  const dto = record.document;
  if (dto?.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
  for (const [id, snapshot] of Object.entries(record.meshes ?? {})) {
    try {
      meshRegistry.register(id as Uuid, HEMesh.fromSnapshot(snapshot));
    } catch {
      // dropped — see docstring
    }
  }
  for (const asset of Object.values(record.textures ?? {})) {
    if (asset?.id && asset.bytes) textureAssets.register(asset);
  }
  return dto;
}

/** Drop a closed project's meshes + textures from the registries (ids are per-project). */
export function releaseProjectMeshes(document: ThrideDocumentDTO): void {
  for (const node of document.nodes) {
    const ref = node.data?.mesh as { id: Uuid } | undefined;
    if (ref?.id) meshRegistry.unregister(ref.id);
  }
  for (const mat of document.materials ?? []) {
    for (const texId of texturesOf(mat)) textureAssets.unregister(texId);
  }
}

// ---- one-time migration from the localStorage autosave ----------------------

const LEGACY_V2 = "thride:autosave:v2";
const LEGACY_V1 = "thride:autosave:v1";

interface LegacyV2Payload {
  document: ThrideDocumentDTO;
  meshes: Record<string, PackedMesh>;
}

/**
 * Import the old localStorage autosave (if any) as a project record and
 * clear the legacy keys. Returns null when nothing usable is stored.
 */
export function migrateLegacyAutosave(id: Uuid, name: string): ProjectRecord | null {
  try {
    const rawV2 = localStorage.getItem(LEGACY_V2);
    if (rawV2) {
      localStorage.removeItem(LEGACY_V2);
      localStorage.removeItem(LEGACY_V1);
      const payload = JSON.parse(rawV2) as LegacyV2Payload;
      const dto = payload.document;
      if (dto?.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
      const meshes: Record<string, HEMeshSnapshot> = {};
      for (const [meshId, packed] of Object.entries(payload.meshes ?? {})) {
        try {
          meshes[meshId] = unpackMesh(packed).snapshot();
        } catch {
          // corrupt legacy mesh — drop it
        }
      }
      return { id, name, updatedAt: Date.now(), document: dto, meshes };
    }
    const rawV1 = localStorage.getItem(LEGACY_V1);
    if (!rawV1) return null;
    localStorage.removeItem(LEGACY_V1);
    const dto = JSON.parse(rawV1) as ThrideDocumentDTO;
    if (dto.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
    return { id, name, updatedAt: Date.now(), document: dto, meshes: {} };
  } catch {
    return null;
  }
}
