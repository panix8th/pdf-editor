import React from 'react';
import { useStore } from '../state/store';

// Common paper sizes in PDF points (1pt = 1/72in), a few points of
// tolerance either way to absorb rounding in real-world PDFs.
const PAPER_SIZES = [
  { name: 'A4', w: 595, h: 842 },
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'A3', w: 842, h: 1191 },
  { name: 'A5', w: 420, h: 595 }
];

function describePageSize(page) {
  if (!page) return null;
  const swapped = page.rotation % 180 !== 0;
  const w = swapped ? page.height : page.width;
  const h = swapped ? page.width : page.height;
  const mmW = Math.round((w * 25.4) / 72);
  const mmH = Math.round((h * 25.4) / 72);
  const match = PAPER_SIZES.find((p) => Math.abs(p.w - w) < 3 && Math.abs(p.h - h) < 3);
  return match ? `${match.name} · ${mmW} × ${mmH} mm` : `${mmW} × ${mmH} mm`;
}

function formatBytes(n) {
  if (!n && n !== 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StatusBar() {
  const doc = useStore((s) => s.documents[s.activeId]);

  if (!doc) {
    return (
      <div className="statusbar">
        <span>Ready</span>
      </div>
    );
  }

  const page = doc.pages[doc.currentPage - 1];
  const pageSize = describePageSize(page);
  const fileMeta = [doc.pdfVersion ? `PDF ${doc.pdfVersion}` : null, formatBytes(doc.fileSize)].filter(Boolean).join(' · ');

  return (
    <div className="statusbar">
      <span className="statusbar-tool">
        <span className="statusbar-dot" />
        {doc.tool[0].toUpperCase() + doc.tool.slice(1)} tool active
      </span>
      <span>
        Page {doc.currentPage} of {doc.pageCount}
      </span>
      <span>{Math.round(doc.zoom * 100)}%</span>
      {pageSize && <span>{pageSize}</span>}
      {doc.isEncrypted && !doc.editingUnsupported && <span>Password-protected (decrypted for editing)</span>}
      {doc.editingUnsupported && <span className="sig-bad">Encryption not supported for editing - view only</span>}
      {doc.signatureStatus && doc.signatureStatus.length > 0 && (
        <span className={doc.signatureStatus.every((s) => s.integrityValid) ? 'sig-ok' : 'sig-bad'}>
          {doc.signatureStatus.every((s) => s.integrityValid) ? '✓ Digitally signed, integrity OK' : '✗ Signature invalid or document modified'}
        </span>
      )}
      <div className="statusbar-spacer" />
      {doc.dirty && <span>Unsaved changes</span>}
      {fileMeta && <span>{fileMeta}</span>}
    </div>
  );
}
