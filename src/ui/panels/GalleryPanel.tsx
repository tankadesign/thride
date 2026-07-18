import { useState } from "react";
import { IconCube, IconSphere } from "@/icons";
import { NumberDrag } from "@/ui/widgets/NumberDrag";

/** Design-system gallery (View → UI Gallery) — daisyUI components at editor sizes. */
export function GalleryPanel() {
  const [num, setNum] = useState(1.5);

  return (
    <div className="flex h-full max-w-xl flex-col gap-4 overflow-auto bg-base-100 p-4 text-xs">
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase opacity-60">Buttons</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-xs">
            Default
          </button>
          <button type="button" className="btn btn-xs btn-primary">
            Primary
          </button>
          <button type="button" className="btn btn-xs btn-ghost">
            Ghost
          </button>
          <button type="button" className="btn btn-xs btn-active">
            Active
          </button>
          <button type="button" className="btn btn-xs btn-square">
            <IconCube />
          </button>
          <button type="button" className="btn btn-xs" disabled>
            Disabled
          </button>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase opacity-60">
          Number drag (scrub / click to type)
        </h3>
        <div className="w-48">
          <NumberDrag label="X" value={num} onChange={(v) => setNum(v)} />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase opacity-60">Inputs</h3>
        <div className="flex w-72 flex-col gap-2">
          <input className="input input-xs" placeholder="Text input" />
          <select className="select select-md">
            <option>Option A</option>
            <option>Option B</option>
          </select>
          <div className="flex items-center gap-3">
            <input type="checkbox" className="checkbox checkbox-xs" defaultChecked />
            <input type="checkbox" className="toggle toggle-xs" defaultChecked />
            <input
              type="range"
              className="range range-xs w-32"
              min={0}
              max={100}
              defaultValue={40}
            />
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase opacity-60">
          Badges / kbd / tooltip
        </h3>
        <div className="flex items-center gap-2">
          <span className="badge badge-xs">badge</span>
          <span className="badge badge-xs badge-primary">primary</span>
          <kbd className="kbd kbd-xs">⌘K</kbd>
          <div className="tooltip" data-tip="Tooltip">
            <button type="button" className="btn btn-xs btn-square">
              <IconSphere />
            </button>
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase opacity-60">Menu</h3>
        <ul className="menu menu-xs w-44 rounded-box bg-base-200">
          <li className="menu-title">Group</li>
          <li>
            <button type="button" className="menu-active">
              Active item
            </button>
          </li>
          <li>
            <button type="button">Item</button>
          </li>
          <li className="menu-disabled">
            <button type="button">Disabled</button>
          </li>
        </ul>
      </section>
    </div>
  );
}
