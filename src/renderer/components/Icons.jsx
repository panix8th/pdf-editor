import React from 'react';

/**
 * Shared 20x20-grid stroke icon set (1.5-1.7 stroke, currentColor),
 * matching the Claude Design handoff spec. Kept in one file so every
 * toolbar/rail/dock icon stays visually consistent.
 */
const base = (size, children, strokeWidth = 1.6) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const IconOpen = ({ size = 15 }) => base(size, <path d="M2.5 5.5h5l2 2h8v8h-15z" />);
export const IconSave = ({ size = 15 }) =>
  base(
    size,
    <>
      <path d="M3.5 3.5h10l3 3v10h-13z" />
      <path d="M6.5 3.5v5h7" />
    </>
  );
export const IconExport = ({ size = 15 }) =>
  base(
    size,
    <>
      <path d="M10 13.5V3" />
      <path d="M6 6.5L10 2.5l4 4" />
      <path d="M3.5 13v4h13v-4" />
    </>
  );
export const IconUndo = ({ size = 16 }) =>
  base(
    size,
    <>
      <path d="M7 5L3.5 8.5 7 12" />
      <path d="M3.5 8.5h8a4.5 4.5 0 010 9H8" />
    </>
  );
export const IconRedo = ({ size = 16 }) =>
  base(
    size,
    <>
      <path d="M13 5l3.5 3.5L13 12" />
      <path d="M16.5 8.5h-8a4.5 4.5 0 000 9H12" />
    </>
  );
export const IconSelect = ({ size = 15 }) => base(size, <path d="M4.5 3l11 7-5 .8-2.2 5.2z" strokeLinejoin="round" />);
export const IconText = ({ size = 15 }) => base(size, <path d="M4.5 5h11M10 5v11" />);
export const IconImage = ({ size = 15 }) =>
  base(
    size,
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7.5" cy="8.5" r="1.4" />
      <path d="M3.5 14l4.5-4 3.5 3 2.5-2 3 3" />
    </>
  );
export const IconHighlight = ({ size = 15 }) =>
  base(
    size,
    <>
      <path d="M4.5 12.5l7-7 3 3-7 7h-3z" />
      <path d="M3.5 17.5h13" />
    </>
  );
export const IconRect = ({ size = 15 }) => base(size, <rect x="3.5" y="5" width="13" height="10" rx="1.5" />);
export const IconEllipse = ({ size = 15 }) => base(size, <ellipse cx="10" cy="10" rx="6.5" ry="5" />);
export const IconLine = ({ size = 15 }) => base(size, <line x1="4" y1="16" x2="16" y2="4" />);
export const IconArrow = ({ size = 15 }) =>
  base(
    size,
    <>
      <line x1="4" y1="16" x2="15.5" y2="4.5" />
      <path d="M10 4.5h5.5V10" />
    </>
  );
export const IconPen = ({ size = 15 }) => base(size, <path d="M3.5 16.5l1.5-4 8-8 2.5 2.5-8 8z" />);
export const IconRedact = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20">
    <rect x="3.5" y="6" width="13" height="8" rx="1.5" fill="currentColor" />
  </svg>
);
export const IconSign = ({ size = 15 }) =>
  base(
    size,
    <>
      <path d="M2.5 13.5c3.5 0 4-9 7-9s1.5 9 4.5 7" />
      <path d="M2.5 16.8h15" />
    </>
  );
export const IconCertify = ({ size = 15 }) =>
  base(
    size,
    <>
      <rect x="4" y="8.5" width="12" height="8" rx="2" />
      <path d="M7 8.5V6a3 3 0 016 0v2.5" />
    </>
  );
export const IconFormField = ({ size = 15 }) =>
  base(
    size,
    <>
      <rect x="2.5" y="6" width="15" height="8" rx="1.5" strokeDasharray="2.5 2" />
      <line x1="5.5" y1="10" x2="5.5" y2="10" strokeWidth="2.2" />
    </>
  );
export const IconPages = ({ size = 17 }) =>
  base(
    size,
    <>
      <rect x="3" y="2.5" width="9" height="12" rx="1.5" />
      <path d="M6.5 17.5h8a1.5 1.5 0 001.5-1.5V6" />
    </>
  ,1.5);
export const IconOutline = ({ size = 17 }) => base(size, <path d="M3 5h14M6 10h11M6 15h8" />, 1.5);
export const IconSearch = ({ size = 17 }) =>
  base(
    size,
    <>
      <circle cx="9" cy="9" r="5.5" />
      <line x1="13" y1="13" x2="17" y2="17" />
    </>
  ,1.5);
export const IconForms = ({ size = 17 }) =>
  base(
    size,
    <>
      <rect x="2.5" y="4" width="15" height="5" rx="1.5" />
      <rect x="2.5" y="12" width="9" height="4" rx="1.5" />
    </>
  ,1.5);
export const IconLayers = ({ size = 17 }) =>
  base(
    size,
    <>
      <path d="M10 2.5l7 4-7 4-7-4z" />
      <path d="M3 11l7 4 7-4" />
    </>
  ,1.5);
// A serif "A" on a baseline - the conventional shorthand for typography.
export const IconFonts = ({ size = 17 }) =>
  base(
    size,
    <>
      <path d="M4.5 14.5L10 4.5l5.5 10" />
      <path d="M6.6 10.8h6.8" />
      <path d="M3 17h14" />
    </>
  ,1.5);
export const IconSinglePage = ({ size = 15 }) => base(size, <rect x="5" y="3" width="10" height="14" rx="1.5" />, 1.5);
export const IconContinuous = ({ size = 15 }) =>
  base(
    size,
    <>
      <rect x="3" y="3" width="14" height="6" rx="1.5" />
      <rect x="3" y="11" width="14" height="6" rx="1.5" />
    </>
  ,1.5);
export const IconRotateView = ({ size = 15 }) =>
  base(
    size,
    <>
      <path d="M16 7A6.5 6.5 0 103.6 11" />
      <path d="M12.5 7H16.5V3" />
    </>
  ,1.5);
export const IconUpload = ({ size = 24 }) =>
  base(
    size,
    <>
      <path d="M10 13.5V3.5" />
      <path d="M6.5 7L10 3.5 13.5 7" />
      <path d="M3.5 13v4h13v-4" />
    </>
  );
export const IconSun = ({ size = 14 }) =>
  base(
    size,
    <>
      <circle cx="10" cy="10" r="4" />
      <line x1="10" y1="1.5" x2="10" y2="4" />
      <line x1="10" y1="16" x2="10" y2="18.5" />
      <line x1="1.5" y1="10" x2="4" y2="10" />
      <line x1="16" y1="10" x2="18.5" y2="10" />
    </>
  ,1.5);
export const IconGear = ({ size = 15 }) =>
  base(
    size,
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </>
  ,1.5);
export const IconMinus = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 11 11">
    <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);
export const IconRestore = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 11 11">
    <rect x="1.5" y="1.5" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
);
export const IconClose = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 11 11">
    <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
    <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);
