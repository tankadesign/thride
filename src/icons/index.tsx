import type { SVGProps } from "react";

/**
 * Original compact icon set (16px grid, currentColor). Blender-5-inspired
 * silhouettes, original artwork — no GPL assets. Grows chunk A5.
 */

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="1.1em"
      height="1.1em"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCursor = (p: P) => (
  <Svg {...p}>
    <path d="M4 2l8 7-4 .6L6.5 13z" />
  </Svg>
);
export const IconPoint = (p: P) => (
  <Svg {...p}>
    <path d="M2 12l5-8 7 9" opacity=".4" />
    <circle cx="2" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="7" cy="4" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="14" cy="13" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconEdge = (p: P) => (
  <Svg {...p}>
    <path d="M3 13L13 3" />
    <circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="13" cy="3" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconPolygon = (p: P) => (
  <Svg {...p}>
    <path d="M3 13V5l10-2v10z" fill="currentColor" fillOpacity=".25" />
  </Svg>
);
export const IconTexture = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M2.5 8h11M8 2.5v11" opacity=".6" />
  </Svg>
);
export const IconCube = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.8L14 5v6l-6 3.2L2 11V5z" />
    <path d="M2 5l6 3 6-3M8 8v6.2" opacity=".6" />
  </Svg>
);
export const IconSphere = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="6" ry="2.4" opacity=".6" />
  </Svg>
);
export const IconCylinder = (p: P) => (
  <Svg {...p}>
    <ellipse cx="8" cy="3.6" rx="5" ry="1.9" />
    <path d="M3 3.6v8.8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V3.6" />
  </Svg>
);
export const IconCone = (p: P) => (
  <Svg {...p}>
    <path d="M8 2l5 10.2M8 2L3 12.2" />
    <ellipse cx="8" cy="12.2" rx="5" ry="1.8" />
  </Svg>
);
export const IconTorus = (p: P) => (
  <Svg {...p}>
    <ellipse cx="8" cy="8" rx="6" ry="4.4" />
    <ellipse cx="8" cy="8" rx="2.4" ry="1.4" />
  </Svg>
);
export const IconPlane = (p: P) => (
  <Svg {...p}>
    <path d="M2 11l4-6h8l-4 6z" />
  </Svg>
);
export const IconCapsule = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="2" width="7" height="12" rx="3.5" />
  </Svg>
);
export const IconPyramid = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5L14 12H2z" />
    <path d="M8 2.5V12" opacity=".6" />
  </Svg>
);
export const IconDisc = (p: P) => (
  <Svg {...p}>
    <ellipse cx="8" cy="8" rx="6" ry="4" />
  </Svg>
);
export const IconNull = (p: P) => (
  <Svg {...p}>
    <path d="M8 2v12M2 8h12" opacity=".7" />
    <circle cx="8" cy="8" r="2.4" />
  </Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}>
    <rect x="1.8" y="4.5" width="8.5" height="7" rx="1.2" />
    <path d="M10.3 7.5l3.9-2.2v5.4l-3.9-2.2z" />
  </Svg>
);
export const IconLight = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="3.2" />
    <path d="M8 1.5V.8M12.6 2.9l.5-.5M14.5 7H15M3.4 2.9l-.5-.5M1.5 7H1M6.5 12.5h3M7 14.5h2" />
  </Svg>
);
export const IconSpline = (p: P) => (
  <Svg {...p}>
    <path d="M2 13C5 13 4 3 8 3s3 10 6 10" />
    <circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="14" cy="13" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconGenerator = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M11.9 4.1l-1.4 1.4M5.5 10.5l-1.4 1.4" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.8" />
  </Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" opacity=".45" />
    <path d="M2.5 13.5l11-11" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Svg>
);
export const IconQuad = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <path d="M8 2v12M2 8h12" />
  </Svg>
);
