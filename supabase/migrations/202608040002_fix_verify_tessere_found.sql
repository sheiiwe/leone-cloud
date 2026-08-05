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
