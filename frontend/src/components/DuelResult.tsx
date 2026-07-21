import { PixelBird } from './PixelBird';
import { tickToSeconds } from '@/lib/outcome';

/** The emotional peak of a duel. Win = gold banner + flapping bird +
 *  green payout; draw = neutral; loss = greyed. Buttons live in the page. */
export function DuelResult({
  won, tie, observer = false, amount, symbol,
  yourScore, theirScore, yourDeathTick = null, theirDeathTick = null,
  yourLabel = 'YOU', theirLabel = 'THEM', winnerSide = 'none', settleTx,
}: {
  won: boolean;
  tie: boolean;
  observer?: boolean;
  amount: string;
  symbol: string;
  yourScore: number;
  theirScore: number;
  yourDeathTick?: number | null;
  theirDeathTick?: number | null;
  yourLabel?: string;
  theirLabel?: string;
  winnerSide?: 'yours' | 'theirs' | 'none';
  settleTx?: string | null;
}) {
  const kind = won ? 'win' : tie ? 'tie' : 'loss';
  const banner = observer ? 'SETTLED' : won ? 'VICTORY' : tie ? 'DRAW' : 'DEFEAT';
  const payout = observer ? `Pot: ${amount} ${symbol}`
    : won ? `+${amount} ${symbol}`
    : tie ? 'Stakes refunded'
    : `−${amount} ${symbol}`;

  // A tie-break makes equal scores decisive, so the highlight follows the recorded winner
  // rather than a score comparison — otherwise a won duel would render 07 — 07 with nothing
  // lit up under a VICTORY banner and read as broken.
  const tieBroken = winnerSide !== 'none' && yourScore === theirScore;
  const showTimes = tieBroken && yourDeathTick !== null && theirDeathTick !== null;

  return (
    <div className={`result result--${kind}`}>
      <div className="result__banner">{banner}</div>
      <div className="result__bird"><PixelBird /></div>
      <p className="result__payout">{payout}</p>
      <div className="scoreboard">
        <div className={`scoreboard__side ${winnerSide === 'yours' ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(yourScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">{yourLabel}</span>
          {showTimes && <span className="scoreboard__time">{tickToSeconds(yourDeathTick!)}s</span>}
        </div>
        <span className="scoreboard__dash">—</span>
        <div className={`scoreboard__side ${winnerSide === 'theirs' ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(theirScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">{theirLabel}</span>
          {showTimes && <span className="scoreboard__time">{tickToSeconds(theirDeathTick!)}s</span>}
        </div>
      </div>
      {showTimes && <p className="result__tiebreak">Tied on score — survived longer wins.</p>}
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
