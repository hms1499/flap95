import { PixelBird } from './PixelBird';

/** The emotional peak of a duel. Win = gold banner + flapping bird +
 *  green payout; draw = neutral; loss = greyed. Buttons live in the page. */
export function DuelResult({ won, tie, amount, symbol, yourScore, theirScore, settleTx }: {
  won: boolean;
  tie: boolean;
  amount: string;
  symbol: string;
  yourScore: number;
  theirScore: number;
  settleTx?: string | null;
}) {
  const kind = won ? 'win' : tie ? 'tie' : 'loss';
  const banner = won ? 'VICTORY' : tie ? 'DRAW' : 'DEFEAT';
  const payout = won ? `+${amount} ${symbol}` : tie ? 'Stakes refunded' : `−${amount} ${symbol}`;

  return (
    <div className={`result result--${kind}`}>
      <div className="result__banner">{banner}</div>
      <div className="result__bird"><PixelBird /></div>
      <p className="result__payout">{payout}</p>
      <div className="scoreboard">
        <div className={`scoreboard__side ${yourScore > theirScore ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(yourScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">YOU</span>
        </div>
        <span className="scoreboard__dash">—</span>
        <div className={`scoreboard__side ${theirScore > yourScore ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(theirScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">THEM</span>
        </div>
      </div>
      {settleTx && (
        <p className="result__link">
          <a href={`https://celoscan.io/tx/${settleTx}`} target="_blank" rel="noreferrer">
            View settlement ↗
          </a>
        </p>
      )}
    </div>
  );
}
