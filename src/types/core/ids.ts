/**
 * Branded UUID string. All document entities are identified by UUIDv7
 * (time-ordered), and all cross-references between entities are by Uuid —
 * never by live object reference.
 */
export type Uuid = string & { readonly __brand: "Uuid" };
