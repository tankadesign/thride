import type { TextureAssetDTO, Uuid } from "@/types/core";

/**
 * Runtime registry of bitmap texture assets, keyed by asset id (referenced from
 * materials as `MaterialDTO.textures[channel]`). Holds the raw encoded image
 * bytes; the render layer decodes them to GPU textures on demand and caches the
 * result. The in-memory companion to the assets persisted in the project record
 * (parallel to the kernel `meshRegistry`). Lives in `io` — pure DTO storage with
 * no three/DOM — so persist (io), decode (render), and create (ui) all import it
 * downward without a lateral dependency (materials is a sibling tier of io).
 */
const assets = new Map<Uuid, TextureAssetDTO>();

export const textureAssets = {
  get(id: Uuid): TextureAssetDTO | undefined {
    return assets.get(id);
  },
  register(asset: TextureAssetDTO): void {
    assets.set(asset.id, asset);
  },
  unregister(id: Uuid): void {
    assets.delete(id);
  },
  has(id: Uuid): boolean {
    return assets.has(id);
  },
};

/** Every texture-asset id a material references across its channels. */
export function texturesOf(mat: { textures?: Record<string, Uuid> }): Uuid[] {
  return mat.textures ? Object.values(mat.textures).filter(Boolean) : [];
}
