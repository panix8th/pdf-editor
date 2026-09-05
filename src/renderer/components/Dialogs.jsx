import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useStore, getResource } from '../state/store';
import { bakeDocument, mergePdfs, splitPdf, exportPagesAsImages } from '../pdf/documentIO';
import { PDFDocument } from 'pdf-lib';
import { applyPasswordProtection } from '../pdf/security';
import { resolveAndCacheGoogleFont } from '../pdf/fetchAndCacheGoogleFont';
import { loadSystemFontFamilies, loadFaceBytes } from '../pdf/systemFontMatch';
import { pickFace } from '../pdf/fontInventory';
import PaperlightMark from './PaperlightMark.jsx';

export default function Dialogs({ dialog }) {
  const closeDialog = useStore((s) => s.closeDialog);
  if (!dialog) return null;

  const backdropClick = (e) => {
    if (e.target === e.currentTarget) closeDialog();
  };

  return (
    <div className="modal-backdrop" onMouseDown={backdropClick}>
      {dialog.type === 'password' && <PasswordDialog {...dialog.props} />}
      {dialog.type === 'merge' && <MergeDialog />}
      {dialog.type === 'split' && <SplitDialog />}
      {dialog.type === 'exportImages' && <ExportImagesDialog />}
      {dialog.type === 'protect' && <ProtectDialog />}
      {dialog.type === 'visualSignature' && <VisualSignatureDialog />}
      {dialog.type === 'digitalSignature' && <DigitalSignatureDialog />}
      {dialog.type === 'verifySignatures' && <VerifySignaturesDialog />}
      {dialog.type === 'insertPages' && <InsertPagesDialog />}
      {dialog.type === 'fontPicker' && <FontPickerDialog {...dialog.props} />}
      {dialog.type === 'googleFontPicker' && <GoogleFontDialog {...dialog.props} />}
      {dialog.type === 'about' && <AboutDialog />}
      {dialog.type === 'confirmClose' && <ConfirmCloseDialog {...dialog.props} />}
    </div>
  );
}

/**
 * Last line of defence before edits are thrown away. Shown when closing a
 * document (or the whole window) that still has unsaved changes - before
 * this existed, both simply discarded the work with no warning at all.
 */
function ConfirmCloseDialog({ names, onSave, onDiscard }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const [busy, setBusy] = useState(false);
  const many = names.length > 1;

  return (
    <Modal title={many ? 'Unsaved changes' : `Unsaved changes in ${names[0]}`}>
      <p className="hint">
        {many
          ? `${names.length} documents have edits that haven't been saved: ${names.join(', ')}.`
          : 'This document has edits that have not been saved yet.'}
      </p>
      <div className="modal-actions">
        <button className="btn" disabled={busy} onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn danger" disabled={busy} onClick={onDiscard}>
          {many ? 'Discard all' : 'Discard changes'}
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving...' : many ? 'Save all' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, wide, children }) {
  return (
    <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PasswordDialog({ fileMeta, retry }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const openFile = useStore((s) => s.openFile);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await openFile(fileMeta, password);
    setBusy(false);
  };

  return (
    <Modal title="Password Required">
      <p>"{fileMeta.name}" is password protected.</p>
      {retry && <p className="error-text">Incorrect password. Try again.</p>}
      <input
        className="field"
        type="password"
        autoFocus
        placeholder="Enter password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? 'Opening...' : 'Open'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function MergeDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const addFiles = async () => {
    const picked = await window.pdfEditor.openPdfDialog();
    setFiles((f) => [...f, ...picked]);
  };
  const move = (i, dir) => {
    const next = [...files];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  };
  const remove = (i) => setFiles(files.filter((_, idx) => idx !== i));

  const doMerge = async () => {
    if (files.length < 2) {
      showToast('error', 'Add at least two PDFs to merge.');
      return;
    }
    setBusy(true);
    try {
      const bytes = await mergePdfs(files);
      const savedPath = await window.pdfEditor.saveAs('merged.pdf', bytes);
      if (savedPath) showToast('info', `Merged PDF saved to ${savedPath}`);
      closeDialog();
    } catch (err) {
      showToast('error', `Merge failed: ${err.message}`);
    }
    setBusy(false);
  };

  return (
    <Modal title="Merge PDFs" wide>
      <div className="file-list">
        {files.map((f, i) => (
          <div key={i} className="file-row">
            <span>{f.name}</span>
            <div className="btn-row">
              <button className="btn btn-icon" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="btn btn-icon" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="btn btn-icon" onClick={() => remove(i)}>
                ✕
              </button>
            </div>
          </div>
        ))}
        {files.length === 0 && <div className="hint">No files added yet.</div>}
      </div>
      <button className="btn" onClick={addFiles}>
        Add PDFs...
      </button>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={doMerge}>
          {busy ? 'Merging...' : 'Merge & Save'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function SplitDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const doc = useStore((s) => s.documents[s.activeId]);
  const [rangesText, setRangesText] = useState(`1-${doc.pageCount}`);
  const [busy, setBusy] = useState(false);

  const parseRanges = () => {
    const parts = rangesText.split(',').map((p) => p.trim()).filter(Boolean);
    const ranges = [];
    for (const part of parts) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) throw new Error(`Invalid range: "${part}"`);
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (from < 1 || to > doc.pageCount || from > to) throw new Error(`Range out of bounds: "${part}"`);
      ranges.push({ from, to });
    }
    if (ranges.length === 0) throw new Error('Enter at least one page range.');
    return ranges;
  };

  const doSplit = async () => {
    setBusy(true);
    try {
      const ranges = parseRanges();
      const resources = getResource(doc.id);
      const bytes = await bakeDocument({ docState: doc, resources, formValues: doc.formValues });
      const results = await splitPdf(bytes, ranges);
      const folder = await window.pdfEditor.pickExportFolder();
      if (!folder) {
        setBusy(false);
        return;
      }
      await window.pdfEditor.writeManyToFolder(folder, results);
      showToast('info', `Saved ${results.length} file(s) to ${folder}`);
      closeDialog();
    } catch (err) {
      showToast('error', err.message);
    }
    setBusy(false);
  };

  return (
    <Modal title="Split PDF">
      <div className="pp-row">
        <label>Page ranges (e.g. 1-3, 4, 5-8)</label>
        <input className="field" value={rangesText} onChange={(e) => setRangesText(e.target.value)} />
      </div>
      <p className="hint">Each range is saved as its own PDF file in a folder you choose.</p>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={doSplit}>
          {busy ? 'Splitting...' : 'Split & Save'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ExportImagesDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const doc = useStore((s) => s.documents[s.activeId]);
  const [format, setFormat] = useState('png');
  const [scope, setScope] = useState('all');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const resources = getResource(doc.id);
      const pageNumbers = scope === 'current' ? [doc.currentPage] : Array.from({ length: doc.pageCount }, (_, i) => i + 1);
      const results = await exportPagesAsImages(resources.pdfjsDoc, pageNumbers, format, scale);
      const folder = await window.pdfEditor.pickExportFolder();
      if (!folder) {
        setBusy(false);
        return;
      }
      await window.pdfEditor.writeManyToFolder(folder, results);
      showToast('info', `Exported ${results.length} image(s) to ${folder}`);
      closeDialog();
    } catch (err) {
      showToast('error', err.message);
    }
    setBusy(false);
  };

  return (
    <Modal title="Export Pages as Images">
      <div className="pp-row">
        <label>Format</label>
        <select className="field" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
        </select>
      </div>
      <div className="pp-row">
        <label>Pages</label>
        <select className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All pages</option>
          <option value="current">Current page only</option>
        </select>
      </div>
      <div className="pp-row">
        <label>Resolution (scale factor)</label>
        <input type="number" min="1" max="6" step="0.5" className="field" value={scale} onChange={(e) => setScale(Number(e.target.value))} />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={doExport}>
          {busy ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ProtectDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const doc = useStore((s) => s.documents[s.activeId]);
  const updateDoc = useStore((s) => s.updateDoc);
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [perms, setPerms] = useState({ allowPrinting: true, allowModifying: false, allowCopying: true, allowAnnotations: true });
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!userPassword && !ownerPassword) {
      showToast('error', 'Enter at least one password.');
      return;
    }
    setBusy(true);
    try {
      const resources = getResource(doc.id);
      const plainBytes = await bakeDocument({ docState: doc, resources, formValues: doc.formValues });
      const pdfDoc = await PDFDocument.load(plainBytes);
      applyPasswordProtection(pdfDoc, { userPassword, ownerPassword, permissions: perms });
      const encrypted = await pdfDoc.save({ useObjectStreams: false });
      const savedPath = await window.pdfEditor.saveAs(doc.name, encrypted);
      if (savedPath) {
        showToast('info', `Password-protected PDF saved to ${savedPath}`);
        updateDoc(doc.id, { isEncrypted: true });
      }
      closeDialog();
    } catch (err) {
      showToast('error', `Could not protect PDF: ${err.message}`);
    }
    setBusy(false);
  };

  return (
    <Modal title="Set Password Protection">
      <div className="pp-row">
        <label>Password to open the document (leave blank for none)</label>
        <input className="field" type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
      </div>
      <div className="pp-row">
        <label>Owner password (controls permissions; optional)</label>
        <input className="field" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
      </div>
      <div className="pp-row">
        <label>Permissions</label>
        {[
          ['allowPrinting', 'Allow printing'],
          ['allowModifying', 'Allow editing'],
          ['allowCopying', 'Allow copying text'],
          ['allowAnnotations', 'Allow annotations']
        ].map(([key, label]) => (
          <div className="check-row" key={key}>
            <input type="checkbox" checked={perms[key]} onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="hint">Saves a new, encrypted copy of the current document (RC4 128-bit, supported by all major PDF readers).</p>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={apply}>
          {busy ? 'Protecting...' : 'Protect & Save As...'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function VisualSignatureDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const doc = useStore((s) => s.documents[s.activeId]);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const [tab, setTab] = useState('draw');
  const [typedText, setTypedText] = useState('Your Name');
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tab !== 'draw') return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
  }, [tab]);

  const pointerPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvasRef.current.width / rect.width), y: (e.clientY - rect.top) * (canvasRef.current.height / rect.height) };
  };
  const onDown = (e) => {
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const onMove = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = pointerPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const onUp = () => (drawing.current = false);
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const place = (dataUrl, aspect) => {
    const page = doc.pages[doc.currentPage - 1];
    const w = 200;
    const h = w / (aspect || 3);
    addAnnotation(doc.id, page.key, {
      id: uuid(),
      type: 'signature',
      x: (page.width - w) / 2,
      y: (page.height - h) / 2,
      w,
      h,
      src: dataUrl
    });
    closeDialog();
  };

  const placeDraw = () => {
    place(canvasRef.current.toDataURL('image/png'), canvasRef.current.width / canvasRef.current.height);
  };

  const placeTyped = () => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 200;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111';
    ctx.font = '90px "Segoe Script", "Brush Script MT", cursive';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedText || 'Signature', 10, c.height / 2);
    place(c.toDataURL('image/png'), c.width / c.height);
  };

  const [uploadedUrl, setUploadedUrl] = useState(null);
  const onUpload = (file) => {
    const reader = new FileReader();
    reader.onload = () => setUploadedUrl(reader.result);
    reader.readAsDataURL(file);
  };
  const placeUpload = () => {
    if (!uploadedUrl) return;
    const img = new Image();
    img.onload = () => place(uploadedUrl, img.width / img.height);
    img.src = uploadedUrl;
  };

  return (
    <Modal title="Add Visual Signature" wide>
      <div className="sig-tabs">
        <button className={`btn ${tab === 'draw' ? 'primary' : ''}`} onClick={() => setTab('draw')}>
          Draw
        </button>
        <button className={`btn ${tab === 'type' ? 'primary' : ''}`} onClick={() => setTab('type')}>
          Type
        </button>
        <button className={`btn ${tab === 'upload' ? 'primary' : ''}`} onClick={() => setTab('upload')}>
          Upload
        </button>
      </div>

      {tab === 'draw' && (
        <>
          <canvas
            ref={canvasRef}
            width={560}
            height={180}
            className="sig-canvas"
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          />
          <div className="btn-row">
            <button className="btn" onClick={clearCanvas}>
              Clear
            </button>
          </div>
        </>
      )}

      {tab === 'type' && (
        <input className="sig-type-input" value={typedText} onChange={(e) => setTypedText(e.target.value)} />
      )}

      {tab === 'upload' && (
        <>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])} />
          {uploadedUrl && <img src={uploadedUrl} alt="signature preview" style={{ maxWidth: '100%', marginTop: 10, background: '#fff' }} />}
        </>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        {tab === 'draw' && (
          <button className="btn primary" onClick={placeDraw}>
            Place on Page
          </button>
        )}
        {tab === 'type' && (
          <button className="btn primary" onClick={placeTyped}>
            Place on Page
          </button>
        )}
        {tab === 'upload' && (
          <button className="btn primary" disabled={!uploadedUrl} onClick={placeUpload}>
            Place on Page
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function DigitalSignatureDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const doc = useStore((s) => s.documents[s.activeId]);
  const [cert, setCert] = useState(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('I approve this document');
  const [location, setLocation] = useState('');
  const [signerName, setSignerName] = useState('');
  const [busy, setBusy] = useState(false);

  const pickCert = async () => {
    const file = await window.pdfEditor.openFileDialog({ title: 'Select certificate', extensions: ['pfx', 'p12'] });
    if (file) setCert(file);
  };

  const doSign = async () => {
    if (!cert) {
      showToast('error', 'Select a .pfx/.p12 certificate file first.');
      return;
    }
    setBusy(true);
    try {
      const resources = getResource(doc.id);
      const plainBytes = await bakeDocument({ docState: doc, resources, formValues: doc.formValues });
      const result = await window.pdfEditor.signDigital(plainBytes, cert.data, password, {
        reason,
        location,
        name: signerName || 'Paperlight Signer'
      });
      if (!result.ok) throw new Error(result.error);
      const savedPath = await window.pdfEditor.saveAs(doc.name, result.data);
      if (savedPath) showToast('info', `Digitally signed PDF saved to ${savedPath}`);
      closeDialog();
    } catch (err) {
      showToast('error', `Signing failed: ${err.message}`);
    }
    setBusy(false);
  };

  return (
    <Modal title="Add Digital Signature">
      <div className="pp-row">
        <label>Certificate (.pfx / .p12)</label>
        <button className="btn" onClick={pickCert}>
          {cert ? cert.name : 'Choose certificate file...'}
        </button>
      </div>
      <div className="pp-row">
        <label>Certificate Password</label>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="pp-row">
        <label>Signer Name</label>
        <input className="field" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
      </div>
      <div className="pp-row">
        <label>Reason</label>
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="pp-row">
        <label>Location</label>
        <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <p className="hint">
        Embeds a cryptographic signature that PDF readers (Acrobat, Chrome, etc.) can validate. This saves a new signed copy of the document.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={doSign}>
          {busy ? 'Signing...' : 'Sign & Save As...'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function VerifySignaturesDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const doc = useStore((s) => s.documents[s.activeId]);
  const sigs = doc.signatureStatus || [];

  return (
    <Modal title="Signature Status" wide>
      {sigs.length === 0 && <p>This document has no digital signatures.</p>}
      {sigs.map((s, i) => (
        <div key={i} className="file-row" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: 8 }}>
          <strong className={s.integrityValid ? 'sig-ok' : 'sig-bad'}>{s.integrityValid ? '✓ Valid - document unmodified since signing' : '✗ Invalid or document modified'}</strong>
          <span>Signer: {s.signerName || 'Unknown'}</span>
          {s.issuer && <span>Issuer: {s.issuer}</span>}
          {s.validTo && <span>Certificate valid: {new Date(s.validFrom).toLocaleDateString()} - {new Date(s.validTo).toLocaleDateString()}</span>}
          <span>{s.certificateCurrentlyValid ? 'Certificate is within its validity period.' : 'Certificate is expired or not yet valid.'}</span>
        </div>
      ))}
      <p className="hint">
        Note: this checks that the signed content hasn't changed and reports what the certificate itself claims. It does not verify the
        certificate against a trusted root authority.
      </p>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function InsertPagesDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const showToast = useStore((s) => s.showToast);
  const doc = useStore((s) => s.documents[s.activeId]);
  const insertPagesFromFile = useStore((s) => s.insertPagesFromFile);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const files = await window.pdfEditor.openPdfDialog();
    if (files.length === 0) return;
    setBusy(true);
    try {
      await insertPagesFromFile(doc.id, doc.currentPage - 1, files[0]);
      closeDialog();
    } catch (err) {
      showToast('error', `Could not insert pages: ${err.message}`);
    }
    setBusy(false);
  };

  return (
    <Modal title="Insert Pages from PDF">
      <p>Pages will be inserted after the current page ({doc.currentPage}).</p>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={pick}>
          {busy ? 'Inserting...' : 'Choose PDF...'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * Every font installed on this machine, listed straight from the OS font
 * directories by the main process. It used to go through Chromium's
 * `queryLocalFonts()`, which meant a permission prompt, a "Continue" step
 * before anything loaded, and an empty list on any system that doesn't
 * expose the API - so the picker frequently showed nothing at all.
 */
function FontPickerDialog({ docId, onPick }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const showToast = useStore((s) => s.showToast);
  const [families, setFamilies] = useState(null);
  const [query, setQuery] = useState('');
  const [applying, setApplying] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadSystemFontFamilies()
      .then((list) => {
        if (cancelled) return;
        setFamilies(list);
        if (list.length === 0) setError('No font files were found in this system\u2019s font directories.');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (family) => {
    setApplying(family.family);
    try {
      const face = pickFace(family.faces, {});
      const { bytes, family: realName } = await loadFaceBytes(face);
      const fontId = `sysfont-${face.postscriptName}-${Date.now()}`;
      registerCustomFont(docId, fontId, bytes, realName);
      onPick({ fontId, fontFamily: realName });
      closeDialog();
    } catch (err) {
      showToast('error', `Could not load "${family.family}": ${err.message}`);
    }
    setApplying(null);
  };

  const q = query.trim().toLowerCase();
  const filtered = (families || []).filter((f) => f.family.toLowerCase().includes(q));

  return (
    <Modal title="Fonts Installed on This PC" wide>
      {families === null && !error && <p>Reading installed fonts...</p>}
      {error && (
        <>
          <p className="error-text">{error}</p>
          <p className="hint">You can still load a specific font file with "Load .ttf/.otf..." instead.</p>
        </>
      )}
      {families !== null && families.length > 0 && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {families.length} families found. The one you pick is embedded into the PDF, so it renders everywhere - not
            just on machines that have it.
          </p>
          <input className="field" placeholder="Filter fonts..." value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="font-list">
            {filtered.map((family) => (
              <div key={family.family} className="font-list-item" onClick={() => pick(family)}>
                <span style={{ fontFamily: `"${family.family}", sans-serif` }}>{family.family}</span>
                {applying === family.family && <span className="hint"> embedding...</span>}
              </div>
            ))}
            {filtered.length === 0 && <div className="hint">No matching fonts.</div>}
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function GoogleFontDialog({ docId, onPick }) {
  const closeDialog = useStore((s) => s.closeDialog);
  const registerCustomFont = useStore((s) => s.registerCustomFont);
  const showToast = useStore((s) => s.showToast);
  const [query, setQuery] = useState('');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | error

  const apply = async () => {
    const family = query.trim();
    if (!family) return;
    setStatus('loading');
    const match = await resolveAndCacheGoogleFont(docId, [family], { bold, italic, registerCustomFont }).catch(() => null);
    if (match) {
      onPick({ fontId: match.fontId, fontFamily: match.fontFamily });
      closeDialog();
    } else {
      setStatus('error');
      showToast('error', `Couldn't find "${family}" on Google Fonts, or you're offline.`);
    }
  };

  return (
    <Modal title="Use a Google Font">
      <p className="hint">
        Type the exact name of any font from <span style={{ userSelect: 'text' }}>fonts.google.com</span> - e.g. "Roboto",
        "Playfair Display", "Bebas Neue".
      </p>
      <div className="pp-row">
        <label>Font name</label>
        <input
          className="field"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setStatus('idle');
          }}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="e.g. Roboto"
        />
      </div>
      <div className="check-row">
        <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
        <span>Bold</span>
      </div>
      <div className="check-row">
        <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} />
        <span>Italic</span>
      </div>
      {status === 'error' && <p className="error-text">Not found on Google Fonts (or no network access right now).</p>}
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={!query.trim() || status === 'loading'} onClick={apply}>
          {status === 'loading' ? 'Fetching...' : 'Use This Font'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function AboutDialog() {
  const closeDialog = useStore((s) => s.closeDialog);
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.pdfEditor.getAppVersion().then(setVersion);
  }, []);
  return (
    <Modal title="About Paperlight">
      <div className="about-lockup">
        <span className="about-mark">
          <PaperlightMark size={40} />
        </span>
        <span className="about-wordmark">
          Paper<span className="accent-text">light</span>
        </span>
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>Version {version}</p>
      <p className="hint">A lightweight, fully offline desktop PDF viewer and editor. No telemetry, no network access.</p>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </Modal>
  );
}
