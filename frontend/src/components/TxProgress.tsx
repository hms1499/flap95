import { PixelBird } from './PixelBird';

/** Installer-style progress for the multi-tx duel flow: players see
 *  which on-chain step they're on (Approve → Deposit → Confirm). */
export function TxProgress({ title, steps, active }: {
  title: string;
  steps: string[];
  active: number;
}) {
  return (
    <div className="tx">
      <div className="tx__head">
        <PixelBird />
        <b>{title}</b>
      </div>
      <ul className="tx-steps">
        {steps.map((label, i) => {
          const state = i < active ? 'is-done' : i === active ? 'is-active' : 'is-pending';
          return (
            <li key={label} className={`tx-step ${state}`}>
              <span className="tx-step__mark">{i < active ? '✓' : i === active ? '►' : ''}</span>
              {label}
            </li>
          );
        })}
      </ul>
      <div className="tx-bar"><span /></div>
    </div>
  );
}
