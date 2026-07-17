'use client';
export function Dialog95({ title, open, onClose, children }: {
  title: string; open: boolean; onClose?: () => void; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="dialog95-overlay">
      <div className="window dialog95">
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          {onClose && (
            <div className="title-bar-controls">
              <button aria-label="Close" onClick={onClose} />
            </div>
          )}
        </div>
        <div className="window-body">{children}</div>
      </div>
    </div>
  );
}
