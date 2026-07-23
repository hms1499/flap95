import Link from 'next/link';

type Shape = { as?: 'block' | 'row'; colSpan?: number };

/** Wraps children as a paragraph or as a full-width table row, per the caller. */
function Slot({ as = 'block', colSpan = 1, children }: Shape & { children: React.ReactNode }) {
  if (as === 'row') return <tr><td colSpan={colSpan}>{children}</td></tr>;
  return <p className="fineprint">{children}</p>;
}

export function Loading(props: Shape) {
  return <Slot {...props}>Loading…</Slot>;
}

/**
 * An empty section. One sentence, no exclamation mark, and at most one next
 * step — an empty list that offers no way forward is a dead end, and four
 * different phrasings of the same idea read as four different products.
 */
export function Empty({ line, action, ...shape }: Shape & {
  line: string; action?: { href: string; label: string };
}) {
  return (
    <Slot {...shape}>
      {line}
      {action && <> · <Link href={action.href}>{action.label}</Link></>}
    </Slot>
  );
}

export function LoadFailed({ onRetry, ...shape }: Shape & { onRetry: () => void }) {
  return (
    <Slot {...shape}>
      ⚠️ Could not load this. <button onClick={onRetry}>Try again</button>
    </Slot>
  );
}
