import { useAtom } from "jotai";
import { CollapsingSection } from "@/ui/panels/CollapsingSection";
import { viewSettingsUiAtom } from "@/ui/hooks/editor/viewport";

/**
 * A CollapsingSection whose open/closed state is remembered in the View Settings
 * UI atom (keyed by `title`), so it survives the modal being closed and reopened.
 * Section titles are unique across the View and Post tabs.
 */
export function ViewSettingsSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [ui, setUi] = useAtom(viewSettingsUiAtom);
  const open = ui.openSections[title] ?? defaultOpen;
  return (
    <CollapsingSection
      title={title}
      open={open}
      onOpenChange={(o) =>
        setUi((s) => ({ ...s, openSections: { ...s.openSections, [title]: o } }))
      }
    >
      {children}
    </CollapsingSection>
  );
}
