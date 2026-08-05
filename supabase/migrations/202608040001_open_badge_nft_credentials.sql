-- Leone Consulting - certificati Open Badge 3.0 con NFT obbligatorio
-- Applicare tramite Supabase migrations prima di distribuire l'interfaccia.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table if not exists public.credential_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.is_credential_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      lower(coalesce((select auth.jwt())->>'email', '')) = 'amministrazione@leoneconsultingitalia.it'
      or coalesce((select auth.jwt())->'app_metadata'->>'role', '') = 'admin'
      or exists (
        select 1
        from public.credential_admins a
        where a.user_id = (select auth.uid())
      )
    );
$$;

revoke all on function private.is_credential_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_credential_admin() to authenticated;

create table if not exists public.credential_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  criteria text not null default '',
  skills text[] not null default '{}',
  achievement_type text not null default 'Course',
  issuer_mode text not null default 'leone'
    check (issuer_mode in ('leone', 'partner', 'joint')),
  issuer_name text not null default 'Leone Consulting di Leonardo Angelucci',
  partner_name text,
  badge_image_url text,
  validity_months integer check (validity_months is null or validity_months > 0),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.credential_code_seq start with 1;

create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  verification_code text not null unique,
  template_id uuid references public.credential_templates(id) on delete set null,
  recipient_name text not null,
  recipient_email text,
  recipient_identifier_hash text not null,
  achievement_name text not null,
  description text not null default '',
  criteria text not null default '',
  skills text[] not null default '{}',
  achievement_type text not null default 'Course',
  issuer_mode text not null default 'leone'
    check (issuer_mode in ('leone', 'partner', 'joint')),
  issuer_name text not null default 'Leone Consulting di Leonardo Angelucci',
  partner_name text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'pending_nft'
    check (status in ('draft', 'pending_nft', 'valid', 'suspended', 'revoked')),
  status_reason text,
  public_name boolean not null default true,
  badge_image_url text,
  evidence_url text,
  pdf_storage_path text,
  open_badge jsonb,
  open_badge_hash text,
  blockchain_network text not null default 'polygon-amoy',
  nft_status text not null default 'pending'
    check (nft_status in ('pending', 'minting', 'minted', 'failed', 'revoked')),
  nft_contract text,
  nft_token_id text,
  nft_tx_hash text,
  nft_explorer_url text,
  nft_token_uri text,
  nft_owner_wallet text,
  nft_minted_at timestamptz,
  nft_revocation_tx_hash text,
  nft_revoked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_minted_fields check (
    nft_status <> 'minted'
    or (
      nft_contract is not null
      and nft_token_id is not null
      and nft_tx_hash is not null
      and nft_minted_at is not null
    )
  ),
  constraint credential_valid_requires_nft check (
    status <> 'valid'
    or (nft_status = 'minted' and open_badge is not null and open_badge_hash is not null)
  )
);

create table if not exists public.credential_events (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.credentials(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}',
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists credentials_status_idx on public.credentials(status);
create index if not exists credentials_recipient_email_idx on public.credentials(lower(recipient_email));
create index if not exists credential_events_credential_idx on public.credential_events(credential_id, created_at desc);

create or replace function private.set_credential_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.nft_status in ('minted', 'revoked') and (
    new.verification_code is distinct from old.verification_code
    or new.recipient_name is distinct from old.recipient_name
    or new.recipient_email is distinct from old.recipient_email
    or new.achievement_name is distinct from old.achievement_name
    or new.achievement_type is distinct from old.achievement_type
    or new.description is distinct from old.description
    or new.criteria is distinct from old.criteria
    or new.skills is distinct from old.skills
    or new.issuer_mode is distinct from old.issuer_mode
    or new.issuer_name is distinct from old.issuer_name
    or new.partner_name is distinct from old.partner_name
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at
    or new.badge_image_url is distinct from old.badge_image_url
    or new.evidence_url is distinct from old.evidence_url
    or new.open_badge is distinct from old.open_badge
    or new.open_badge_hash is distinct from old.open_badge_hash
  ) then
    raise exception 'Il contenuto di un credential già emesso non è modificabile; usare sospensione o revoca.';
  end if;

  if new.verification_code is null or btrim(new.verification_code) = '' then
    new.verification_code := 'LCB-'
      || to_char(coalesce(new.issued_at, now()), 'YYYY')
      || '-'
      || lpad(nextval('public.credential_code_seq')::text, 6, '0');
  else
    new.verification_code := upper(btrim(new.verification_code));
  end if;

  if tg_op = 'INSERT'
    or new.recipient_identifier_hash is null
    or btrim(new.recipient_identifier_hash) = ''
    or new.recipient_email is distinct from old.recipient_email
    or new.recipient_name is distinct from old.recipient_name then
    new.recipient_identifier_hash := encode(
      extensions.digest(
        lower(coalesce(new.recipient_email, new.recipient_name))
          || ':' || new.verification_code || ':' || new.id::text,
        'sha256'
      ),
      'hex'
    );
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_credential_defaults on public.credentials;
create trigger set_credential_defaults
before insert or update on public.credentials
for each row execute function private.set_credential_defaults();

create or replace function private.touch_credential_template()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_credential_template on public.credential_templates;
create trigger touch_credential_template
before update on public.credential_templates
for each row execute function private.touch_credential_template();

create or replace function private.log_credential_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif old.status is distinct from new.status then
    v_event := 'status_changed';
  elsif old.nft_status is distinct from new.nft_status then
    v_event := 'nft_status_changed';
  else
    return new;
  end if;

  insert into public.credential_events (credential_id, event_type, detail, actor_id)
  values (
    new.id,
    v_event,
    jsonb_build_object('status', new.status, 'nft_status', new.nft_status),
    (select auth.uid())
  );
  return new;
end;
$$;

drop trigger if exists log_credential_event on public.credentials;
create trigger log_credential_event
after insert or update on public.credentials
for each row execute function private.log_credential_event();

alter table public.credential_admins enable row level security;
alter table public.credential_templates enable row level security;
alter table public.credentials enable row level security;
alter table public.credential_events enable row level security;

drop policy if exists credential_admins_manage on public.credential_admins;
create policy credential_admins_manage on public.credential_admins
for all to authenticated
using ((select private.is_credential_admin()))
with check ((select private.is_credential_admin()));

drop policy if exists credential_templates_manage on public.credential_templates;
create policy credential_templates_manage on public.credential_templates
for all to authenticated
using ((select private.is_credential_admin()))
with check ((select private.is_credential_admin()));

drop policy if exists credentials_manage on public.credentials;
create policy credentials_manage on public.credentials
for all to authenticated
using ((select private.is_credential_admin()))
with check ((select private.is_credential_admin()));

drop policy if exists credential_events_read on public.credential_events;
create policy credential_events_read on public.credential_events
for select to authenticated
using ((select private.is_credential_admin()));

revoke all on table public.credential_admins from anon, authenticated;
revoke all on table public.credential_templates from anon, authenticated;
revoke all on table public.credentials from anon, authenticated;
revoke all on table public.credential_events from anon, authenticated;
grant select, insert, update, delete on table public.credential_admins to authenticated;
grant select, insert, update, delete on table public.credential_templates to authenticated;
grant select, insert, update, delete on table public.credentials to authenticated;
grant select on table public.credential_events to authenticated;
revoke all on sequence public.credential_code_seq from anon, authenticated;

-- RPC pubblico: restituisce solo i dati strettamente necessari alla verifica.
-- Non espone email, wallet, percorsi privati o altri dati del titolare.
create or replace function public.verify_leone_asset(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_card record;
  v_credential public.credentials%rowtype;
  v_status text;
  v_valid boolean;
begin
  if v_code = '' or length(v_code) > 80 then
    return jsonb_build_object('found', false, 'code', v_code, 'checked_at', now());
  end if;

  if to_regclass('public.tessere') is not null then
    execute $query$
      select codice, nome, ruolo, emessa_il as data_emissione, scade_il as data_scadenza,
             not coalesce(attiva, true) as revocato
      from public.tessere
      where upper(codice) = $1
      limit 1
    $query$ into v_card using v_code;

    if v_card.codice is not null then
      v_status := case
        when v_card.revocato then 'revoked'
        when v_card.data_scadenza is not null and v_card.data_scadenza < current_date then 'expired'
        else 'valid'
      end;
      return jsonb_build_object(
        'found', true,
        'kind', 'tesserino',
        'code', v_card.codice,
        'valid', v_status = 'valid',
        'status', v_status,
        'holder_name', btrim(coalesce(v_card.nome, '')),
        'role', v_card.ruolo,
        'issued_at', v_card.data_emissione,
        'expires_at', v_card.data_scadenza,
        'issuer_name', 'Leone Consulting di Leonardo Angelucci',
        'checked_at', now()
      );
    end if;
  end if;

  select * into v_credential
  from public.credentials
  where upper(verification_code) = v_code
  limit 1;

  if found then
    v_status := case
      when v_credential.status = 'revoked' or v_credential.nft_status = 'revoked' then 'revoked'
      when v_credential.status = 'suspended' then 'suspended'
      when v_credential.expires_at is not null and v_credential.expires_at < now() then 'expired'
      when v_credential.status = 'valid' and v_credential.nft_status = 'minted' then 'valid'
      else 'pending'
    end;
    v_valid := v_status = 'valid';

    return jsonb_build_object(
      'found', true,
      'kind', 'credential',
      'code', v_credential.verification_code,
      'valid', v_valid,
      'status', v_status,
      'holder_name', case when v_credential.public_name then v_credential.recipient_name else 'Nome riservato' end,
      'achievement_name', v_credential.achievement_name,
      'description', v_credential.description,
      'criteria', v_credential.criteria,
      'skills', to_jsonb(v_credential.skills),
      'issuer_name', v_credential.issuer_name,
      'issuer_mode', v_credential.issuer_mode,
      'partner_name', v_credential.partner_name,
      'issued_at', v_credential.issued_at,
      'expires_at', v_credential.expires_at,
      'badge_image_url', v_credential.badge_image_url,
      'evidence_url', v_credential.evidence_url,
      'open_badge', v_credential.open_badge,
      'open_badge_hash', v_credential.open_badge_hash,
      'nft', jsonb_build_object(
        'status', v_credential.nft_status,
        'network', v_credential.blockchain_network,
        'contract', v_credential.nft_contract,
        'token_id', v_credential.nft_token_id,
        'transaction_hash', v_credential.nft_tx_hash,
        'explorer_url', v_credential.nft_explorer_url,
        'token_uri', v_credential.nft_token_uri,
        'minted_at', v_credential.nft_minted_at,
        'revocation_transaction_hash', v_credential.nft_revocation_tx_hash,
        'revoked_at', v_credential.nft_revoked_at,
        'non_transferable', true
      ),
      'checked_at', now()
    );
  end if;

  return jsonb_build_object('found', false, 'code', v_code, 'checked_at', now());
end;
$$;

revoke all on function public.verify_leone_asset(text) from public;
grant execute on function public.verify_leone_asset(text) to anon, authenticated;
