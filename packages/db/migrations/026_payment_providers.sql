-- Provider adapters (docs/21): a webhook names a payment by (provider, provider_ref) and a KYC
-- verdict by (kyc_provider, kyc_ref). The sandbox wrote provider_ref already; it is unique per provider.
create unique index payments_provider_pair on payments (provider, provider_ref) where provider_ref is not null;
alter table users add column kyc_provider text, add column kyc_ref text;
create unique index users_kyc_ref on users (kyc_provider, kyc_ref) where kyc_ref is not null;
