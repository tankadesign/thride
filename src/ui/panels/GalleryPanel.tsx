import { useState } from "react";
import { Button } from "@/ui/widgets/Button";
import { Checkbox } from "@/ui/widgets/Checkbox";
import { NumberDrag } from "@/ui/widgets/NumberDrag";
import { Select } from "@/ui/widgets/Select";

/** Design-system gallery (open a "Gallery" panel via View menu). */
export function GalleryPanel() {
  const [num, setNum] = useState(1.5);
  const [check, setCheck] = useState(true);
  const [sel, setSel] = useState<"a" | "b" | "c">("a");

  return (
    <div className="t-gallery">
      <div>
        <div className="t-section-title">Buttons</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button active>Active</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
      <div>
        <div className="t-section-title">Number drag (scrub / click to type)</div>
        <div style={{ width: 200 }}>
          <NumberDrag label="X" value={num} onChange={(v) => setNum(v)} />
        </div>
      </div>
      <div>
        <div className="t-section-title">Select / checkbox</div>
        <div style={{ display: "flex", gap: 12, width: 300 }}>
          <Select
            value={sel}
            onChange={setSel}
            options={[
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
              { value: "c", label: "Option C" },
            ]}
          />
          <Checkbox checked={check} onChange={setCheck} label="Enabled" />
        </div>
      </div>
      <div>
        <div className="t-section-title">Rows</div>
        <div className="t-row">
          <span className="t-row-label">Position</span>
          <NumberDrag label="X" value={0} onChange={() => {}} />
          <NumberDrag label="Y" value={0} onChange={() => {}} />
          <NumberDrag label="Z" value={0} onChange={() => {}} />
        </div>
      </div>
    </div>
  );
}
