-- Leone Consulting - tipi di certificato NFT e rapporti aziendali
-- Aggiunge metadati per procacciatori, docenti/tutor, dipendenti, collaboratori e partner.

alter table public.credentials
  add column if not exists certificate_type text not null default 'formazione',
  add column if not exists subject_type text not null default 'persona',
  add column if not exists role text,
  add column if not exists relationship_start date,
  add column if not exists relationship_end date,
  add column if not exists contract_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'credentials_certificate_type_check'
      and conrelid = 'public.credentials'::regclass
  ) then
    alter table public.credentials
      add constraint credentials_certificate_type_check
      check (certificate_type in (
        'formazione','procacciatore','docente','tutor','docente_tutor',
        'dipendente','collaboratore','consulente','partner_aziendale','altro'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'credentials_subject_type_check'
      and conrelid = 'public.credentials'::regclass
  ) then
    alter table public.credentials
      add constraint credentials_subject_type_check
      check (subject_type in ('persona','azienda'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'credentials_relationship_dates_check'
      and conrelid = 'public.credentials'::regclass
  ) then
    alter table public.credentials
      add constraint credentials_relationship_dates_check
      check (
        relationship_start is null
        or relationship_end is null
        or relationship_end >= relationship_start
      );
  end if;
end $$;

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
    or new.certificate_type is distinct from old.certificate_type
    or new.subject_type is distinct from old.subject_type
    or new.role is distinct from old.role
    or new.relationship_start is distinct from old.relationship_start
    or new.relationship_end is distinct from old.relationship_end
    or new.contract_reference is distinct from old.contract_reference
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
      when v_credential.relationship_end is not null and v_credential.relationship_end < current_date then 'expired'
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
      'certificate_type', v_credential.certificate_type,
      'subject_type', v_credential.subject_type,
      'role', v_credential.role,
      'relationship_start', v_credential.relationship_start,
      'relationship_end', v_credential.relationship_end,
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
