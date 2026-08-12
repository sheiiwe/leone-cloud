-- Badge Wallet specifico per il portale aperto.
-- Evita che un account con piu ruoli (es. docente e procacciatore)
-- visualizzi il tesserino sbagliato.

create unique index if not exists tessere_tipo_rif_uidx
  on public.tessere (tipo, rif_id)
  where rif_id is not null;

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
  v_status text;
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

  v_status := case
    when not coalesce(v_card.attiva, true) then 'revocato'
    when v_card.scade_il is not null and v_card.scade_il < current_date then 'scaduto'
    else 'valido'
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
    'apple_pass_url', case
      when v_card.wallet_enabled and v_card.apple_wallet_status = 'emesso'
      then v_card.apple_pass_url else null end,
    'google_save_url', case
      when v_card.wallet_enabled and v_card.google_wallet_status = 'emesso'
      then v_card.google_save_url else null end
  );
end;
$$;

revoke all on function public.get_my_wallet_badge_for_portal(text) from public, anon;
grant execute on function public.get_my_wallet_badge_for_portal(text) to authenticated;

