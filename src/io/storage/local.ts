import type { Document } from "@/core";
import { FORMAT_VERSION, type ThrideDocumentDTO } from "@/types/core";

/**
 * Interim project persistence ahead of the real .thride package (H1):
 * the whole document DTO, autosaved to localStorage on every scene change
 * so a refresh or crash doesn't lose work. Superseded by OPFS (H2) once
 * mesh/material/animation stores exist beyond the scene DTO.
 */
const STORAGE_KEY = "thride:autosave:v1";
const DEBOUNCE_MS = 400;

/** Last autosaved project, or null if none exists / it fails to parse. */
export function loadLocalProject(): ThrideDocumentDTO | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const dto = JSON.parse(raw) as ThrideDocumentDTO;
    if (dto.formatVersion !== FORMAT_VERSION || !Array.isArray(dto.nodes)) return null;
    return dto;
  } catch {
    return null;
  }
}

function saveLocalProject(doc: Document): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc.toDTO()));
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
