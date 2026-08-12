-- Apple Wallet: archivio privato dei pass e download mediante token non prevedibile.

alter table public.tessere
  add column if not exists wallet_download_token uuid not null default gen_random_uuid(),
  add column if not exists apple_storage_path text;

create unique index if not exists tessere_wallet_download_token_uidx
  on public.tessere (wallet_download_token);

do $$ begin
  alter table public.tessere add constraint tessere_apple_storage_path_chk
    check (apple_storage_path is null or apple_storage_path ~ '^apple/[A-Za-z0-9_-]+[.]pkpass$');
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wallet-passes',
  'wallet-passes',
  false,
  2097152,
  array['application/vnd.apple.pkpass']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists wallet_passes_admin_select on storage.objects;
drop policy if exists wallet_passes_admin_insert on storage.objects;
drop policy if exists wallet_passes_admin_update on storage.objects;
drop policy if exists wallet_passes_admin_delete on storage.objects;

create policy wallet_passes_admin_select on storage.objects
for select to authenticated
using (bucket_id = 'wallet-passes' and (select public.is_admin()));

create policy wallet_passes_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'wallet-passes' and (select public.is_admin()));

create policy wallet_passes_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'wallet-passes' and (select public.is_admin()))
with check (bucket_id = 'wallet-passes' and (select public.is_admin()));

create policy wallet_passes_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'wallet-passes' and (select public.is_admin()));

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
      when v_card.wallet_enabled
        and v_card.apple_wallet_status = 'emesso'
        and v_status = 'valido'
        and v_card.apple_storage_path is not null
      then v_wallet_base || v_card.wallet_download_token::text
      else null end,
    'google_save_url', case
      when v_card.wallet_enabled and v_card.google_wallet_status = 'emesso'
      then v_card.google_save_url else null end
  );
end;
$$;

revoke all on function public.get_my_wallet_badge_for_portal(text) from public, anon;
grant execute on function public.get_my_wallet_badge_for_portal(text) to authenticated;
