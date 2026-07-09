/** Editor interaction modes; drives the context-sensitive toolbar. */
export type EditMode = "object" | "point" | "edge" | "polygon" | "texture";

/** Component-selection modes (subset of EditMode that addresses mesh elements). */
export type ComponentMode = "point" | "edge" | "polygon";
