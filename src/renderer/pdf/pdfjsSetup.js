import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL; keeps rendering fully offline
// (no CDN worker) and bundled into the packaged app.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export default pdfjsLib;
