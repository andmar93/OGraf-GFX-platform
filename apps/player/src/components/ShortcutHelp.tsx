import { SHORTCUTS } from '../lib/shortcuts.ts';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}><td><kbd>{s.keys}</kbd></td><td>{s.label}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Shortcuts are disabled while typing in a field; press Esc to leave the field.</p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
