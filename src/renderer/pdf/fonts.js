import { StandardFonts } from 'pdf-lib';

/**
 * Built-in font families. These map to the 14 base PDF fonts, which every
 * compliant PDF reader ships with, so no embedding is required for them.
 * Custom fonts (loaded by the user) are always embedded + subset so the
 * document renders identically everywhere.
 */
export const STANDARD_FONT_FAMILIES = [
  { id: 'Helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { id: 'TimesRoman', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'Courier', label: 'Courier', css: '"Courier New", Courier, monospace' }
];

const STANDARD_VARIANTS = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique
  }
};

export function resolveStandardFont(family, bold, italic) {
  const variants = STANDARD_VARIANTS[family] || STANDARD_VARIANTS.Helvetica;
  if (bold && italic) return variants.boldItalic;
  if (bold) return variants.bold;
  if (italic) return variants.italic;
  return variants.regular;
}

export function isCustomFont(family) {
  return !STANDARD_VARIANTS[family];
}
