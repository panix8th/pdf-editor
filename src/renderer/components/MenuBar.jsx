import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { IconSun, IconGear } from './Icons.jsx';

const ACCENTS = [
  { id: 'lilac', dark: '#b49bf0', light: '#6b43d6' },
  { id: 'orchid', dark: '#d79bef', light: '#a233c9' },
  { id: 'periwinkle', dark: '#9aa8f5', light: '#4a53cf' }
];

/**
 * The application menu, drawn by the renderer: frame:false removes the
 * native one entirely (main.js sets no application menu at all, because
 * its accelerators stopped firing once the bar was hidden), so this and
 * App.jsx's keydown handler are the only two ways to reach any command.
 * Both dispatch the same action ids through runMenuAction. `disabled`
 * reads live document state so items grey out like a native menu would.
 */
function buildMenus(hasDoc, hasSelection, canUndo, canRedo) {
  return [
    {
      label: 'File',
      items: [
        { label: 'Open PDF...', shortcut: 'Ctrl+O', action: 'file:open' },
        { label: 'Save', shortcut: 'Ctrl+S', action: 'file:save', disabled: !hasDoc },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: 'file:saveAs', disabled: !hasDoc },
        { sep: true },
        { label: 'Merge PDFs...', action: 'file:merge' },
        { label: 'Split PDF...', action: 'file:split', disabled: !hasDoc },
        { label: 'Export Pages as Images...', action: 'file:exportImages', disabled: !hasDoc },
        { sep: true },
        { label: 'Set / Remove Password...', action: 'file:password', disabled: !hasDoc },
        { sep: true },
        { label: 'Close Document', shortcut: 'Ctrl+W', action: 'file:close', disabled: !hasDoc }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: 'edit:undo', disabled: !canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'edit:redo', disabled: !canRedo },
        { sep: true },
        { label: 'Delete Selected', shortcut: 'Delete', action: 'edit:deleteSelected', disabled: !hasSelection },
        { sep: true },
        { label: 'Find...', shortcut: 'Ctrl+F', action: 'edit:find', disabled: !hasDoc }
      ]
    },
    {
      label: 'Annotate',
      items: [
        { label: 'Add Text Box', shortcut: 'Ctrl+T', action: 'tool:text', disabled: !hasDoc },
        { label: 'Insert Image', action: 'tool:image', disabled: !hasDoc },
        { label: 'Highlight', action: 'tool:highlight', disabled: !hasDoc },
        { label: 'Rectangle', action: 'tool:rect', disabled: !hasDoc },
        { label: 'Ellipse', action: 'tool:ellipse', disabled: !hasDoc },
        { label: 'Line', action: 'tool:line', disabled: !hasDoc },
        { label: 'Arrow', action: 'tool:arrow', disabled: !hasDoc },
        { label: 'Freehand Pen', action: 'tool:pen', disabled: !hasDoc },
        { label: 'Add Form Field', action: 'tool:formfield', disabled: !hasDoc },
        { label: 'Redact', action: 'tool:redact', disabled: !hasDoc },
        { sep: true },
        { label: 'Fill Form Fields', action: 'tool:form', disabled: !hasDoc }
      ]
    },
    {
      label: 'Sign',
      items: [
        { label: 'Add Visual Signature...', action: 'sign:visual', disabled: !hasDoc },
        { label: 'Add Digital Signature...', action: 'sign:digital', disabled: !hasDoc },
        { label: 'Verify Signatures', action: 'sign:verify', disabled: !hasDoc }
      ]
    },
    {
      label: 'Page',
      items: [
        { label: 'Insert Blank Page', action: 'page:insertBlank', disabled: !hasDoc },
        { label: 'Insert PDF Pages...', action: 'page:insertFromFile', disabled: !hasDoc },
        { label: 'Delete Page', action: 'page:delete', disabled: !hasDoc },
        { label: 'Duplicate Page', action: 'page:duplicate', disabled: !hasDoc },
        { label: 'Rotate Left', action: 'page:rotateLeft', disabled: !hasDoc },
        { label: 'Rotate Right', action: 'page:rotateRight', disabled: !hasDoc }
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: 'Ctrl+=', action: 'view:zoomIn', disabled: !hasDoc },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: 'view:zoomOut', disabled: !hasDoc },
        { label: 'Fit Width', action: 'view:fitWidth', disabled: !hasDoc },
        { label: 'Fit Page', action: 'view:fitPage', disabled: !hasDoc },
        { sep: true },
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: 'view:toggleSidebar' },
        { label: 'Toggle Theme', shortcut: 'Ctrl+J', action: 'view:toggleTheme' }
      ]
    },
    {
      label: 'Help',
      items: [{ label: 'About Paperlight', action: 'help:about' }]
    }
  ];
}

export default function MenuBar({ runMenuAction }) {
  const doc = useStore((s) => s.documents[s.activeId]);
  const theme = useStore((s) => s.theme);
  const accent = useStore((s) => s.accent);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setAccent = useStore((s) => s.setAccent);
  const [openMenu, setOpenMenu] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpenMenu(null);
        setSettingsOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const hasDoc = !!doc;
  const hasSelection = !!doc?.selection;
  const canUndo = !!doc && doc.history.past.length > 0;
  const canRedo = !!doc && doc.history.future.length > 0;
  const menus = buildMenus(hasDoc, hasSelection, canUndo, canRedo);

  const pick = (action) => {
    setOpenMenu(null);
    runMenuAction(action);
  };

  return (
    <div className="menubar" ref={rootRef}>
      {menus.map((m) => (
        <div key={m.label} style={{ position: 'relative' }}>
          <div
            className={`menubar-item ${openMenu === m.label ? 'open' : ''}`}
            onClick={() => setOpenMenu(openMenu === m.label ? null : m.label)}
            onMouseEnter={() => openMenu && setOpenMenu(m.label)}
          >
            {m.label}
          </div>
          {openMenu === m.label && (
            <div className="menubar-dropdown">
              {m.items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="menubar-separator" />
                ) : (
                  <div key={it.label} className={`menubar-dropdown-item ${it.disabled ? 'disabled' : ''}`} onClick={() => !it.disabled && pick(it.action)}>
                    <span>{it.label}</span>
                    {it.shortcut && <span className="menubar-dropdown-shortcut">{it.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}

      <div className="menubar-spacer" />

      <div className="theme-pill" onClick={toggleTheme}>
        <IconSun />
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </div>

      <div style={{ position: 'relative' }}>
        <div className={`settings-btn ${settingsOpen ? 'open' : ''}`} title="Settings" onClick={() => setSettingsOpen((v) => !v)}>
          <IconGear />
        </div>
        {settingsOpen && (
          <div className="settings-dropdown">
            <span className="settings-label">Accent</span>
            <div className="accent-swatches">
              {ACCENTS.map((a) => (
                <div
                  key={a.id}
                  className={`accent-swatch ${accent === a.id ? 'selected' : ''}`}
                  style={{ background: theme === 'dark' ? a.dark : a.light }}
                  title={a.id}
                  onClick={() => setAccent(a.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
