-- Collega in modo sicuro le agevolazioni attivate prima del gestionale.
-- L'amministratore sceglie un account portale approvato; la funzione risolve
-- anche l'eventuale auth.users corrispondente, senza esporre auth.users al client.

create or replace function public.collega_agevolazione_attiva(
  p_agevolazione_id uuid,
  p_user_email text,
  p_activated_at timestamptz default now(),
  p_account_email text default null,
  p_access_url text default null,
  p_external_reference text default null,
  p_expires_at timestamptz default null,
  p_messaggio_utente text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_user_email, '')));
  v_nome text;
  v_area text;
  v_aree text[];
  v_ruoli_agevolazione text[];
  v_ruolo text;
  v_user_id uuid;
  v_id uuid;
  v_activated_at timestamptz := coalesce(p_activated_at, now());
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Operazione riservata all’amministrazione' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'E-mail account non valida' using errcode = '22023';
  end if;

  select a.ruoli
    into v_ruoli_agevolazione
  from public.agevolazioni a
  where a.id = p_agevolazione_id;

  if not found then
    raise exception 'Agevolazione non trovata' using errcode = 'P0002';
  end if;

  select pa.nome, pa.area, coalesce(pa.aree, '{}'::text[])
    into v_nome, v_area, v_aree
  from public.portale_accessi pa
  where lower(pa.email) = v_email
    and pa.approvato = true
  order by pa.created_at desc
  limit 1;

  if not found then
    raise exception 'Account portale non trovato o non approvato' using errcode = 'P0002';
  end if;

  v_ruolo := case
    when v_area = any(v_ruoli_agevolazione) then v_area
    when 'dipendente' = any(v_aree) and 'dipendente' = any(v_ruoli_agevolazione) then 'dipendente'
    when 'docente' = any(v_aree) and 'docente' = any(v_ruoli_agevolazione) then 'docente'
    when 'procacciatore' = any(v_aree) and 'procacciatore' = any(v_ruoli_agevolazione) then 'procacciatore'
    else null
  end;

  if v_ruolo is null then
    raise exception 'Il ruolo dell’account non è abilitato per questa agevolazione' using errcode = '42501';
  end if;

  if p_expires_at is not null and p_expires_at < v_activated_at then
    raise exception 'La scadenza non può precedere l’attivazione' using errcode = '22023';
  end if;

  select u.id
    into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  insert into public.agevolazioni_richieste (
    agevolazione_id,
    user_id,
    user_email,
    nome_utente,
    ruolo,
    stato,
    account_email,
    access_url,
    external_reference,
    requested_at,
    activated_at,
    expires_at,
    messaggio_utente
  ) values (
    p_agevolazione_id,
    v_user_id,
    v_email,
    nullif(btrim(coalesce(v_nome, '')), ''),
    v_ruolo,
    'attiva',
    nullif(lower(btrim(coalesce(p_account_email, ''))), ''),
    nullif(left(btrim(coalesce(p_access_url, '')), 2000), ''),
    nullif(left(btrim(coalesce(p_external_reference, '')), 500), ''),
    v_activated_at,
    v_activated_at,
    p_expires_at,
    nullif(left(btrim(coalesce(p_messaggio_utente, '')), 1200), '')
  )
  on conflict (agevolazione_id, user_email) do update
  set user_id = coalesce(excluded.user_id, public.agevolazioni_richieste.user_id),
      nome_utente = excluded.nome_utente,
      ruolo = excluded.ruolo,
      stato = 'attiva',
      account_email = excluded.account_email,
      access_url = excluded.access_url,
      external_reference = excluded.external_reference,
      activated_at = excluded.activated_at,
      expires_at = excluded.expires_at,
      messaggio_utente = excluded.messaggio_utente
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.collega_agevolazione_attiva(
  uuid, text, timestamptz, text, text, text, timestamptz, text
) from public, anon;
grant execute on function public.collega_agevolazione_attiva(
  uuid, text, timestamptz, text, text, text, timestamptz, text
) to authenticated;

comment on function public.collega_agevolazione_attiva(
  uuid, text, timestamptz, text, text, text, timestamptz, text
) is 'Collega a un account portale approvato un’agevolazione già attiva; solo amministrazione.';
