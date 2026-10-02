-- Organization ownership is handed over with a single-use claim link, never by matching an
-- (unverified) email address. Only the token's hash is stored.
create table org_owner_claims (
  token_hash  text primary key,
  org_id      text not null references organizations(id),
  email       text,                                    -- who the link was meant for (display only)
  created_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  claimed_by  text references users(id),
  claimed_at  timestamptz,
  revoked_at  timestamptz
);
create index org_owner_claims_org on org_owner_claims (org_id);

-- Pending email-based ownership no longer grants anything; the team re-issues a claim link.
update organizations set settings = settings - 'owner_email' where settings ? 'owner_email';
