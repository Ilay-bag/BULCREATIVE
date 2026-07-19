/**
 * Minimal stroke icon set (24px grid, 1.8 stroke) — the app's only icon
 * source; no emoji in UI chrome. Sized via the `size` prop, colored via
 * currentColor.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconUpload = (p: IconProps) => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></Svg>
);
export const IconImage = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></Svg>
);
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}><path d="M12 3l1.8 5.7 5.7 1.8-5.7 1.8L12 18l-1.8-5.7L4.5 10.5l5.7-1.8Z" /><path d="M19 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" /></Svg>
);
export const IconLayers = (p: IconProps) => (
  <Svg {...p}><path d="m12 2 10 6-10 6L2 8Z" /><path d="m2 13 10 6 10-6" /></Svg>
);
export const IconPencil = (p: IconProps) => (
  <Svg {...p}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></Svg>
);
export const IconType = (p: IconProps) => (
  <Svg {...p}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></Svg>
);
export const IconArchive = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></Svg>
);
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" /><path d="M3 21v-5h5" /></Svg>
);
export const IconX = (p: IconProps) => (
  <Svg {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>
);
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>
);
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Svg>
);
export const IconMaximize = (p: IconProps) => (
  <Svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>
);
export const IconCompare = (p: IconProps) => (
  <Svg {...p}><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></Svg>
);
export const IconLightbulb = (p: IconProps) => (
  <Svg {...p}><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" /></Svg>
);
export const IconTarget = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Svg>
);
export const IconPalette = (p: IconProps) => (
  <Svg {...p}><path d="M12 22a10 10 0 1 1 10-10c0 1.7-1.3 3-3 3h-2.2a2 2 0 0 0-1.5 3.3c.3.4.5.8.5 1.3a2.3 2.3 0 0 1-2.3 2.4Z" /><circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="7.5" r="1" fill="currentColor" stroke="none" /></Svg>
);
export const IconSend = (p: IconProps) => (
  <Svg {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></Svg>
);
export const IconTag = (p: IconProps) => (
  <Svg {...p}><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" /><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" /></Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></Svg>
);
export const IconChart = (p: IconProps) => (
  <Svg {...p}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15v-4" /><path d="M12 15V7" /><path d="M17 15v-6" /></Svg>
);
export const IconMove = (p: IconProps) => (
  <Svg {...p}><path d="m5 9-3 3 3 3" /><path d="m9 5 3-3 3 3" /><path d="m15 19-3 3-3-3" /><path d="m19 9 3 3-3 3" /><path d="M2 12h20" /><path d="M12 2v20" /></Svg>
);
export const IconResize = (p: IconProps) => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2h-4" /><path d="m14 14 7 7" /></Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14" /><path d="M5 12h14" /></Svg>
);
export const IconChat = (p: IconProps) => (
  <Svg {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.6A8 8 0 1 1 21 12Z" /></Svg>
);
export const IconWand = (p: IconProps) => (
  <Svg {...p}><path d="m15 4 5 5L7 22l-5-5Z" /><path d="M13 6.5 17.5 11" /><path d="M20 2l.6 1.9L22.5 4.5l-1.9.6L20 7l-.6-1.9L17.5 4.5l1.9-.6Z" /></Svg>
);
