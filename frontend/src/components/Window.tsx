export function Window({ title, children, className }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`window ${className ?? ''}`}>
      <div className="title-bar">
        <div className="title-bar-text">{title}</div>
        <div className="title-bar-controls" aria-hidden="true">
          <button aria-label="Minimize" tabIndex={-1} />
          <button aria-label="Maximize" tabIndex={-1} />
          <button aria-label="Close" tabIndex={-1} />
        </div>
      </div>
      <div className="window-body">{children}</div>
    </div>
  );
}
