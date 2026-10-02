import {
  Activity, AlertTriangle, BadgeEuro, BookOpen, Building2, Coins, CreditCard, Diamond, FileText, Gauge, Gem, KeyRound, LayoutDashboard,
  Landmark, ListChecks, Trophy, Swords, Gift, Plug, ScrollText, Settings, ShieldAlert, ShieldCheck, Table2, UserCog, Users, Webhook, Wallet, ArrowLeftRight, History, DoorOpen, Code2, Network,
  type LucideIcon,
} from 'lucide-react';
import type { PortalKind } from '../lib/portals.ts';

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }
export interface NavGroup { label?: string; items: NavItem[] }

export const NAV: Record<PortalKind, NavGroup[]> = {
  admin: [
    { items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }, { to: 'tables', label: 'Live tables', icon: Table2 }] },
    { label: 'Integrity', items: [
      { to: 'review', label: 'Review queue', icon: ListChecks },
      { to: 'rounds', label: 'Rounds explorer', icon: History },
      { to: 'risk', label: 'Risk', icon: ShieldAlert },
      { to: 'alerts', label: 'Alerts', icon: AlertTriangle },
    ] },
    { label: 'People & orgs', items: [
      { to: 'users', label: 'Users', icon: Users },
      { to: 'orgs', label: 'Organizations', icon: Building2 },
    ] },
    { label: 'Money', items: [
      { to: 'ledger', label: 'Ledger', icon: Landmark },
      { to: 'statements', label: 'Statements', icon: FileText },
      { to: 'payments', label: 'Payments', icon: CreditCard },
      { to: 'book', label: 'Odds book', icon: BookOpen },
    ] },
    { label: 'Growth', items: [
      { to: 'leaderboards', label: 'Leaderboards', icon: Trophy },
      { to: 'tournaments', label: 'Tournaments', icon: Swords },
      { to: 'promotions', label: 'Promotions', icon: Gift },
      { to: 'agents', label: 'Agents', icon: Network },
    ] },
    { label: 'Platform', items: [
      { to: 'audit', label: 'Audit', icon: ShieldCheck },
      { to: 'settings', label: 'Settings', icon: Settings },
    ] },
  ],
  club: [
    { items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }] },
    { label: 'Tables', items: [
      { to: 'tables', label: 'Tables', icon: Table2 },
      { to: 'staff', label: 'Staff & devices', icon: UserCog },
      { to: 'hands', label: 'Hand log', icon: History },
    ] },
    { label: 'Play', items: [
      { to: 'rooms', label: 'Rooms', icon: DoorOpen },
      { to: 'leaderboards', label: 'Leaderboards', icon: Trophy },
      { to: 'tournaments', label: 'Tournaments', icon: Swords },
      { to: 'promotions', label: 'Promotions', icon: Gift },
      { to: 'chips', label: 'Chips', icon: Coins },
      { to: 'players', label: 'Players', icon: Users },
    ] },
    { label: 'Business', items: [
      { to: 'revenue', label: 'Revenue share', icon: BadgeEuro },
      { to: 'members', label: 'Members', icon: UserCog },
      { to: 'settings', label: 'Settings', icon: Settings },
    ] },
  ],
  partner: [
    { items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }] },
    { label: 'Integration', items: [
      { to: 'keys', label: 'API keys', icon: KeyRound },
      { to: 'webhooks', label: 'Webhooks', icon: Webhook },
      { to: 'widget', label: 'Widget', icon: Plug },
      { to: 'docs', label: 'Integration docs', icon: Code2 },
    ] },
    { label: 'Reporting', items: [
      { to: 'bets', label: 'Bets report', icon: Activity },
      { to: 'statements', label: 'Statements', icon: FileText },
    ] },
    { label: 'Team', items: [{ to: 'members', label: 'Members', icon: UserCog }] },
  ],
  organizer: [
    { items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }, { to: 'rooms', label: 'Rooms', icon: DoorOpen }] },
    { label: 'Growth', items: [
      { to: 'leaderboards', label: 'Leaderboards', icon: Trophy },
      { to: 'tournaments', label: 'Tournaments', icon: Swords },
      { to: 'promotions', label: 'Promotions', icon: Gift },
    ] },
    { label: 'Currencies', items: [
      { to: 'diamonds', label: 'Diamonds', icon: Gem },
      { to: 'chips', label: 'Chips', icon: Coins },
      { to: 'treasury', label: 'Treasury & collateral', icon: Wallet },
      { to: 'transfers', label: 'Transfers to players', icon: ArrowLeftRight },
    ] },
    { label: 'People', items: [
      { to: 'players', label: 'Players', icon: Users },
      { to: 'statements', label: 'Statements', icon: ScrollText },
      { to: 'members', label: 'Members', icon: UserCog },
    ] },
  ],
  agent: [
    { items: [{ to: '', label: 'Overview', icon: LayoutDashboard, end: true }] },
  ],
};

export const PORTAL_ICON: Record<PortalKind, LucideIcon> = { admin: Gauge, club: Building2, partner: Plug, organizer: Diamond, agent: Network };
