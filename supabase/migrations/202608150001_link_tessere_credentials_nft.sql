-- Collega ogni tesserino aziendale alla sua prova NFT non trasferibile.
-- Il tesserino resta in emissione finche il mint non e confermato.

alter table public.credentials
  add column if not exists tessera_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'credentials_tessera_id_fkey'
      and conrelid = 'public.credentials'::regclass
  ) then
    alter table public.credentials
      add constraint credentials_tessera_id_fkey
      foreign key (tessera_id) references public.tessere(id) on delete restrict;
  end if;
end $$;

create unique index if not exists credentials_tessera_id_uidx
  on public.credentials (tessera_id)
  where tessera_id is not null;

-- Il tipo amministratore usa lo stesso registro NFT degli altri ruoli.
alter table public.credentials
  drop constraint if exists credentials_certificate_type_check;
alter table public.credentials
  add constraint credentials_certificate_type_check
  check (certificate_type in (
    'formazione','procacciatore','docente','tutor','docente_tutor',
    'dipendente','amministratore','collaboratore','consulente',
    'partner_aziendale','altro'
  ));

-- Backfill prudente: collega soltanto corrispondenze univoche di tipo e identita.
-- In particolare riusa un NFT gia emesso senza crearne un duplicato.
with candidate_links as (
  select
    t.id as tessera_id,
    c.id as credential_id,
    count(*) over (partition by t.id) as matches_for_card,
    count(*) over (partition by c.id) as matches_for_credential
  from public.tessere t
  join public.credentials c
    on c.tessera_id is null
   and c.status <> 'revoked'
   and c.certificate_type = case
     when t.tipo = 'amministratore' then 'amministratore'
     when t.tipo = 'procacciatore' and lower(coalesce(t.ruolo, '')) like '%partner%' then 'partner_aziendale'
     when t.tipo = 'procacciatore' then 'procacciatore'
     when t.tipo = 'docente'
       and lower(coalesce(t.ruolo, '')) like '%docente%'
       and lower(coalesce(t.ruolo, '')) like '%tutor%' then 'docente_tutor'
     when t.tipo = 'docente' and lower(coalesce(t.ruolo, '')) like '%tutor%' then 'tutor'
     when t.tipo = 'docente' then 'docente'
     when t.tipo = 'dipendente' then 'dipendente'
     else t.tipo
   end
   and (
     (
       nullif(lower(btrim(coalesce(t.owner_email, ''))), '') is not null
       and lower(btrim(coalesce(c.recipient_email, ''))) = lower(btrim(t.owner_email))
     )
     or (
       nullif(lower(btrim(coalesce(t.owner_email, ''))), '') is null
       and lower(regexp_replace(btrim(coalesce(c.recipient_name, '')), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(coalesce(t.nome, '')), '\s+', ' ', 'g'))
     )
   )
)
update public.credentials c
set tessera_id = x.tessera_id
from candidate_links x
where c.id = x.credential_id
  and x.matches_for_card = 1
  and x.matches_for_credential = 1;

create or replace function private.protect_credential_tessera_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.tessera_id is not null
    and new.tessera_id is distinct from old.tessera_id
    and old.nft_status in ('minted', 'revoked') then
    raise exception 'Il collegamento tra tesserino e prova NFT emessa non e modificabile.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_credential_tessera_link on public.credentials;
create trigger protect_credential_tessera_link
before update of tessera_id on public.credentials
for each row execute function private.protect_credential_tessera_link();

-- Verifica pubblica unica: il QR del tesserino espone anche la prova NFT.
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

  select
    t.id, t.codice, t.nome, t.ruolo,
    t.emessa_il as data_emissione, t.scade_il as data_scadenza,
    not coalesce(t.attiva, true) as revocato
  into v_card
  from public.tessere t
  where upper(t.codice) = v_code
  limit 1;

  if found then
    select * into v_credential
    from public.credentials c
    where c.tessera_id = v_card.id
    order by c.issued_at desc
    limit 1;

    v_status := case
      when v_card.revocato then 'revoked'
      when v_credential.id is not null
        and (v_credential.status = 'revoked' or v_credential.nft_status = 'revoked') then 'revoked'
      when v_card.data_scadenza is not null and v_card.data_scadenza < current_date then 'expired'
      when v_credential.id is not null and v_credential.status = 'suspended' then 'suspended'
      when v_credential.id is not null
        and v_credential.relationship_end is not null
        and v_credential.relationship_end < current_date then 'expired'
      when v_credential.id is not null
        and v_credential.expires_at is not null
        and v_credential.expires_at < now() then 'expired'
      when v_credential.id is not null
        and v_credential.status = 'valid'
        and v_credential.nft_status = 'minted' then 'valid'
      else 'pending'
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
      'credential_code', v_credential.verification_code,
      'nft', case when v_credential.id is null then null else jsonb_build_object(
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
      ) end,
      'checked_at', now()
    );
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

-- Nei quattro portali il badge e i pulsanti Wallet sono disponibili soltanto
-- quando la prova NFT collegata e valida.
create or replace function public.get_my_wallet_badge_for_portal(p_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_card public.tessere%rowtype;
  v_credential public.credentials%rowtype;
  v_status text;
  v_wallet_base constant text := 'https://uljdbdbkiulbcquuhfwd.supabase.co/functions/v1/wallet-pass?token=';
begin
  if v_email = '' then
    raise exception 'Autenticazione richiesta' using errcode = '42501';
  end if;

  if v_tipo not in ('procacciatore', 'docente', 'dipendente', 'amministratore') then
    raise exception 'Tipo di portale non valido' using errcode = '22023';
  end if;

  select * into v_card
  from public.tessere t
  where lower(coalesce(t.owner_email, '')) = v_email
    and t.tipo = v_tipo
  order by coalesce(t.attiva, false) desc, t.creata_il desc
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_credential
  from public.credentials c
  where c.tessera_id = v_card.id
  order by c.issued_at desc
  limit 1;

  v_status := case
    when not coalesce(v_card.attiva, true) then 'revocato'
    when v_credential.id is not null
      and (v_credential.status = 'revoked' or v_credential.nft_status = 'revoked') then 'revocato'
    when v_card.scade_il is not null and v_card.scade_il < current_date then 'scaduto'
    when v_credential.id is not null
      and v_credential.expires_at is not null
      and v_credential.expires_at < now() then 'scaduto'
    when v_credential.id is not null
      and v_credential.status = 'valid'
      and v_credential.nft_status = 'minted' then 'valido'
    else 'in_emissione'
  end;

  return jsonb_build_object(
    'found', true,
    'code', v_card.codice,
    'name', v_card.nome,
    'role', v_card.ruolo,
    'type', v_card.tipo,
    'photo_url', v_card.foto_url,
    'issued_at', v_card.emessa_il,
    'expires_at', v_card.scade_il,
    'status', v_status,
    'verify_url', 'https://verifica.leoneconsultingitalia.it/' || v_card.codice,
    'wallet_enabled', v_card.wallet_enabled,
    'apple_status', v_card.apple_wallet_status,
    'google_status', v_card.google_wallet_status,
    'credential_code', v_credential.verification_code,
    'nft_status', v_credential.nft_status,
    'nft_network', v_credential.blockchain_network,
    'nft_token_id', v_credential.nft_token_id,
    'nft_explorer_url', v_credential.nft_explorer_url,
    'nft_non_transferable', true,
    'apple_pass_url', case
      when v_card.wallet_enabled
        and v_card.apple_wallet_status = 'emesso'
        and v_status = 'valido'
        and v_card.apple_storage_path is not null
      then v_wallet_base || v_card.wallet_download_token::text
      else null end,
    'google_save_url', case
      when v_card.wallet_enabled
        and v_card.google_wallet_status = 'emesso'
        and v_status = 'valido'
      then v_card.google_save_url else null end
  );
end;
$$;

revoke all on function public.get_my_wallet_badge_for_portal(text) from public, anon;
grant execute on function public.get_my_wallet_badge_for_portal(text) to authenticated;
