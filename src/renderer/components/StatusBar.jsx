import React from 'react';
import { useStore } from '../state/store';

export default function StatusBar() {
  const doc = useStore((s) => s.documents[s.activeId]);

  if (!doc) {
    return (
      <div className="statusbar">
        <span>Ready</span>
      </div>
    );
  }

  return (
    <div className="statusbar">
      <span>{doc.name}</span>
      <span>
        Page {doc.currentPage} / {doc.pageCount}
      </span>
      <span>{Math.round(doc.zoom * 100)}%</span>
      {doc.isEncrypted && !doc.editingUnsupported && <span>Password-protected (decrypted for editing)</span>}
      {doc.editingUnsupported && <span className="sig-bad">Encryption not supported for editing - view only</span>}
      {doc.signatureStatus && doc.signatureStatus.length > 0 && (
        <span className={doc.signatureStatus.every((s) => s.integrityValid) ? 'sig-ok' : 'sig-bad'}>
          {doc.signatureStatus.every((s) => s.integrityValid) ? '✓ Digitally signed, integrity OK' : '✗ Signature invalid or document modified'}
        </span>
      )}
      {doc.dirty && <span>Unsaved changes</span>}
    </div>
  );
}
