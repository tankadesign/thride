/**
 * Composition root. Wires the document core, render systems, and UI shell.
 * For now: an empty dark shell proving the toolchain boots (chunk A1).
 */
export function App() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        color: "var(--t-fg-dim)",
        userSelect: "none",
      }}
    >
      thride
    </div>
  );
}
