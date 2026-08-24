import React from 'react';

/**
 * The Paperlight mark: a rounded stem plus a half-ring bowl, on a 64x64
 * box (see assets/brand/README.md - "Geometry (single source of truth)").
 * Never redraw this by hand or restyle the strokes; only scale it. Below
 * 24px use `small`, which widens the stem/stroke so it survives
 * rasterization at tiny sizes, per the brand spec.
 */
export default function PaperlightMark({ size = 22, small = false, color = 'currentColor' }) {
  return small ? (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="14" y="10" width="10" height="44" rx="5" fill={color} />
      <path d="M24 15h10a13 13 0 010 26H24" stroke={color} strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="14" y="10" width="9" height="44" rx="4.5" fill={color} />
      <path d="M23 14.5h11a13 13 0 010 26H23" stroke={color} strokeWidth="9" strokeLinecap="round" fill="none" />
    </svg>
  );
}
