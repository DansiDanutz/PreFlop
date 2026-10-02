import type { Room, Wallet } from '@preflop/client';
import { Badge, Card } from '@preflop/ui';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { amountLabel, isPool, roomWallet } from '../lib/rooms.ts';

/** An organizer's room in the lobby: its table, currency, house and the player's wallet there. */
export function RoomCard({ room, wallets }: { room: Room; wallets: readonly Wallet[] | undefined }) {
  const w = roomWallet(wallets, room);
  const diamonds = room.currency === 'DIAMOND';
  return (
    <Card className="flex items-center gap-3 p-4">
      <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 text-xl ${diamonds ? 'border-info text-info' : 'border-accent text-accent'}`}>
        {diamonds ? '◆' : '●'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{room.name}</h3>
        </div>
        <p className="truncate text-[13px] text-muted">{room.org_name} · {room.table_name}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={diamonds ? 'info' : 'accent'} className="px-2! py-0.5! text-[10px]!">{diamonds ? 'Diamonds' : 'Chips'}</Badge>
          <Badge tone="muted" className="px-2! py-0.5! text-[10px]!">{isPool(room) ? 'Player pool' : 'Organizer house'}</Badge>
          <span className="text-[12px] text-muted">{w ? `You have ${amountLabel(w.balance_minor, room.currency)}` : `Min ${amountLabel(room.rules.min_stake_minor, room.currency)}`}</span>
        </div>
      </div>
      <Link to={`/app/table/${room.table_id}?room=${encodeURIComponent(room.id)}`}
        className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-[8px] border border-line-strong px-3 text-sm font-semibold hover:border-accent hover:text-accent">
        Enter <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}
