import type { Document } from "@/core";
import { FORMAT_VERSION, type ThrideDocumentDTO, type Uuid } from "@/types/core";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { type PackedMesh, packMesh, unpackMesh } from "./meshPack";

/**
 * Interim project persistence ahead of the real .thride package (H1):
 * the document DTO plus every referenced kernel mesh (base64-packed),
 * autosaved to localStorage on every scene change so a refresh or crash
 * doesn't lose work — including converted/edited meshes. Superseded by
 * OPFS (H2) once mesh/material/animation stores outgrow localStorage.
 */
const STORAGE_KEY = "thride:autosave:v2";
const LEGACY_KEY = "thride:autosave:v1"; // document only — meshes were never saved
const DEBOUNCE_MS = 400;

interface AutosavePayload {
  document: ThrideDocumentDTO;
  /** Kernel meshes referenced by nodes, keyed by mesh id. */
  meshes: Record<string, PackedMesh>;
}

/**
 * Last autosaved project, or null if none exists / it fails to parse.
 * Side effect: registers the saved kernel meshes into the meshRegistry so
 * the scene rebuild that follows loadDTO() finds them.
 */
export function loadLocalProject(): ThrideDocumentDTO | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const payload = JSON.parse(raw) as AutosavePayload;
      const dto = payload.document;
      if (dto?.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
      for (const [id, packed] of Object.entries(payload.meshes ?? {})) {
        try {
          meshRegistry.register(id as Uuid, unpackMesh(packed));
        } catch {
          // corrupt mesh entry: drop it — the node falls back to placeholder
        }
      }
      return dto;
    }
    // migrate a v1 payload (bare DTO; converted meshes were lost before v2)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    localStorage.removeItem(LEGACY_KEY);
    const dto = JSON.parse(legacy) as ThrideDocumentDTO;
    if (dto.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
    return dto;
  } catch {
    return null;
  }
}

function saveLocalProject(doc: Document): void {
  try {
    const document = doc.toDTO();
    const meshes: Record<string, PackedMesh> = {};
    for (const node of document.nodes) {
      const ref = node.data?.mesh as { id: Uuid } | undefined;
      if (!ref?.id || meshes[ref.id]) continue;
      const mesh = meshRegistry.get(ref.id);
      if (mesh) meshes[ref.id] = packMesh(mesh);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ document, meshes } as AutosavePayload));
  } catch {
    // storage full/unavailable (private browsing, quota) — best-effort autosave
  }
}

/** Debounced autosave on every scene change, plus a final flush on unload. */
export function startAutosave(doc: Document): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveLocalProject(doc);
    }, DEBOUNCE_MS);
  };
  const flush = () => saveLocalProject(doc);
  const unsub = doc.subscribeSlice("scene", schedule);
  window.addEventListener("beforeunload", flush);
  return () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("beforeunload", flush);
    unsub();
  };
}
