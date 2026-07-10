import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { docAtom } from "@/ui/hooks/doc/document";
import { bootWorkspace } from "@/ui/hooks/doc/projects";
import { Shell } from "@/ui/shell/Shell";

/**
 * Composition root. The multi-project workspace boots asynchronously from
 * IndexedDB (restoring last session's tabs, migrating any legacy
 * localStorage autosave); the Shell renders once the active document is
 * installed into docAtom.
 */
export function App() {
  const [error, setError] = useState<string | null>(null);
  const doc = useAtomValue(docAtom);

  useEffect(() => {
    bootWorkspace().catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center bg-base-300 text-xs text-error">
        Failed to open workspace: {error}
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="grid h-full place-items-center bg-base-300">
        <span className="loading loading-spinner loading-sm opacity-40" />
      </div>
    );
  }
  return <Shell doc={doc} />;
}
