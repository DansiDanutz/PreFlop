import { type Db, tx } from '../lib/db.ts';
import { type LeaderboardRow, accrue, lockBoard, settle } from './leaderboards.ts';
import { tournamentTick } from './tournaments.ts';

/**
 * Leaderboard upkeep (docs/16 §2): opens scheduled boards, accrues margin and contribution into
 * live pools, settles boards that have ended, and ends promotions past their window. Each board is
 * handled in its own transaction under its row lock, so several workers can run safely.
 */
export async function growthTick(db: Db, now = new Date()): Promise<{ opened: number; accrued: number; settled: number }> {
  const opened = (await db.query(`update leaderboards set status = 'active' where status = 'scheduled' and starts_at <= $1`, [now])).rowCount ?? 0;
  await db.query(`update promotions set status = 'ended' where status = 'approved' and ends_at <= $1`, [now]);
  let accrued = 0, settled = 0;
  const live = (await db.query<{ id: string; ended: boolean }>(`select id, ends_at <= $1 as ended from leaderboards where status = 'active' order by ends_at`, [now])).rows;
  for (const b of live) {
    // One board that cannot settle (it rolls back) must not hold up the others.
    try {
      if (b.ended) {
        if (await tx(db, (c) => settle(c, b.id, now))) settled++;
      } else {
        accrued += await tx(db, async (c) => {
          const lb: LeaderboardRow | undefined = await lockBoard(c, b.id);
          return lb && lb.status === 'active' ? accrue(c, lb, now) : 0;
        });
      }
    } catch (e) {
      console.error('growth worker: leaderboard', b.id, e);
    }
  }
  return { opened, accrued, settled };
}

export function startGrowthWorker(db: Db, everyMs = 60_000, tournamentsEveryMs = 10_000): () => void {
  let running = false, runningT = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await growthTick(db); } catch (e) { console.error('growth worker', e); } finally { running = false; }
  }, everyMs);
  // Tournaments finish on a clock players watch: complete them within seconds of the last flop.
  const tTimer = setInterval(async () => {
    if (runningT) return;
    runningT = true;
    try { await tournamentTick(db); } catch (e) { console.error('tournament worker', e); } finally { runningT = false; }
  }, tournamentsEveryMs);
  return () => { clearInterval(timer); clearInterval(tTimer); };
}
