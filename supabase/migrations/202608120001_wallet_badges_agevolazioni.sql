-- Badge Wallet e agevolazioni aziendali Leone Consulting
-- Identita e autorizzazioni riusano auth.jwt()->>'email', is_admin() e puo_area().

create extension if not exists pgcrypto;

-- Il tesserino resta la sorgente ufficiale del badge. I link Wallet saranno
-- valorizzati solo dai servizi di emissione Apple/Google, mai dal portale.
alter table public.tessere
  add column if not exists owner_email text,
  add column if not exists wallet_enabled boolean not null default true,
  add column if not exists apple_wallet_status text not null default 'non_configurato',
  add column if not exists google_wallet_status text not null default 'non_configurato',
  add column if not exists apple_serial text,
  add column if not exists google_object_id text,
  add column if not exists apple_pass_url text,
  add column if not exists google_save_url text,
  add column if not exists wallet_updated_at timestamptz not null default now();

update public.tessere
set owner_email = 'amministrazione@leoneconsultingitalia.it'
where tipo = 'amministratore'
  and nullif(btrim(owner_email), '') is null;

do $$ begin
  alter table public.tessere add constraint tessere_owner_email_lower_chk
    check (owner_email is null or owner_email = lower(btrim(owner_email)));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tessere add constraint tessere_apple_wallet_status_chk
    check (apple_wallet_status in ('non_configurato','in_attesa','emesso','revocato','errore'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tessere add constraint tessere_google_wallet_status_chk
    check (google_wallet_status in ('non_configurato','in_attesa','emesso','revocato','errore'));
exception when duplicate_object then null; end $$;

create unique index if not exists tessere_apple_serial_uidx
  on public.tessere (apple_serial) where apple_serial is not null;
create unique index if not exists tessere_google_object_uidx
  on public.tessere (google_object_id) where google_object_id is not null;
create index if not exists tessere_owner_email_idx
  on public.tessere (lower(owner_email)) where owner_email is not null;

-- La lettura pubblica dei tesserini autenticati era troppo ampia. Il portale
-- usera la funzione sicura get_my_wallet_badge(); l'amministratore mantiene CRUD.
drop policy if exists tessere_read on public.tessere;
drop policy if exists tessere_self_read on public.tessere;

create or replace function public.get_my_wallet_badge()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_card public.tessere%rowtype;
  v_status text;
begin
  if v_email = '' then
    raise exception 'Autenticazione richiesta' using errcode = '42501';
  end if;

  select * into v_card
  from public.tessere t
  where lower(coalesce(t.owner_email, '')) = v_email
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
    'apple_pass_url', case when v_card.wallet_enabled and v_card.apple_wallet_status = 'emesso' then v_card.apple_pass_url else null end,
    'google_save_url', case when v_card.wallet_enabled and v_card.google_wallet_status = 'emesso' then v_card.google_save_url else null end
  );
end;
$$;

revoke all on function public.get_my_wallet_badge() from public, anon;
grant execute on function public.get_my_wallet_badge() to authenticated;

create table if not exists public.agevolazioni (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  fornitore text not null,
  descrizione text not null default '',
  istruzioni text not null default '',
  logo_url text,
  info_url text,
  ruoli text[] not null default array['procacciatore','docente','dipendente']::text[],
  attiva boolean not null default true,
  richiede_approvazione boolean not null default true,
  valid_from date,
  valid_until date,
  ordinamento integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agevolazioni_slug_chk check (slug ~ '^[a-z0-9_]+$'),
  constraint agevolazioni_ruoli_chk check (ruoli <@ array['procacciatore','docente','dipendente']::text[]),
  constraint agevolazioni_date_chk check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.agevolazioni_richieste (
  id uuid primary key default gen_random_uuid(),
  agevolazione_id uuid not null references public.agevolazioni(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_email text not null,
  nome_utente text,
  ruolo text not null,
  stato text not null default 'richiesta',
  nota_utente text,
  messaggio_utente text,
  account_email text,
  access_url text,
  external_reference text,
  requested_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint agevolazioni_richieste_ruolo_chk check (ruolo in ('procacciatore','docente','dipendente','amministratore')),
  constraint agevolazioni_richieste_stato_chk check (stato in ('richiesta','in_lavorazione','attiva','rifiutata','revocata','scaduta')),
  constraint agevolazioni_richieste_email_chk check (user_email = lower(btrim(user_email))),
  constraint agevolazioni_richieste_unique unique (agevolazione_id, user_email)
);

-- Le note interne non sono nella stessa riga visibile al personale.
create table if not exists public.agevolazioni_note_admin (
  id uuid primary key default gen_random_uuid(),
  richiesta_id uuid not null references public.agevolazioni_richieste(id) on delete cascade,
  nota text not null,
  created_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now()
);

create index if not exists agevolazioni_attive_idx on public.agevolazioni (attiva, ordinamento);
create index if not exists agevolazioni_ruoli_gin_idx on public.agevolazioni using gin (ruoli);
create index if not exists agevolazioni_richieste_email_idx on public.agevolazioni_richieste (lower(user_email));
create index if not exists agevolazioni_richieste_stato_idx on public.agevolazioni_richieste (stato, requested_at desc);
create index if not exists agevolazioni_note_richiesta_idx on public.agevolazioni_note_admin (richiesta_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agevolazioni_set_updated_at on public.agevolazioni;
create trigger agevolazioni_set_updated_at
before update on public.agevolazioni
for each row execute function private.set_updated_at();

drop trigger if exists agevolazioni_richieste_set_updated_at on public.agevolazioni_richieste;
create trigger agevolazioni_richieste_set_updated_at
before update on public.agevolazioni_richieste
for each row execute function private.set_updated_at();

alter table public.agevolazioni enable row level security;
alter table public.agevolazioni_richieste enable row level security;
alter table public.agevolazioni_note_admin enable row level security;

drop policy if exists agevolazioni_admin_all on public.agevolazioni;
create policy agevolazioni_admin_all on public.agevolazioni
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists agevolazioni_personale_select on public.agevolazioni;
create policy agevolazioni_personale_select on public.agevolazioni
for select to authenticated
using (
  attiva
  and (valid_from is null or valid_from <= current_date)
  and (valid_until is null or valid_until >= current_date)
  and exists (
    select 1 from unnest(ruoli) as r(ruolo)
    where public.puo_area(r.ruolo)
  )
);

drop policy if exists agevolazioni_richieste_admin_all on public.agevolazioni_richieste;
create policy agevolazioni_richieste_admin_all on public.agevolazioni_richieste
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists agevolazioni_richieste_self_select on public.agevolazioni_richieste;
create policy agevolazioni_richieste_self_select on public.agevolazioni_richieste
for select to authenticated
using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists agevolazioni_note_admin_all on public.agevolazioni_note_admin;
create policy agevolazioni_note_admin_all on public.agevolazioni_note_admin
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.agevolazioni from anon;
revoke all on public.agevolazioni_richieste from anon;
revoke all on public.agevolazioni_note_admin from anon;
grant select, insert, update, delete on public.agevolazioni to authenticated;
grant select, insert, update, delete on public.agevolazioni_richieste to authenticated;
grant select, insert, update, delete on public.agevolazioni_note_admin to authenticated;

create or replace function public.richiedi_agevolazione(p_agevolazione_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_nome text;
  v_ruolo text;
  v_id uuid;
begin
  if v_uid is null or v_email = '' then
    raise exception 'Autenticazione richiesta' using errcode = '42501';
  end if;

  select pa.nome,
         case
           when 'dipendente' = any(coalesce(pa.aree, '{}'::text[])) or pa.area = 'dipendente' then 'dipendente'
           when 'docente' = any(coalesce(pa.aree, '{}'::text[])) or pa.area = 'docente' then 'docente'
           when 'procacciatore' = any(coalesce(pa.aree, '{}'::text[])) or pa.area = 'procacciatore' then 'procacciatore'
           else null
         end
  into v_nome, v_ruolo
  from public.portale_accessi pa
  where lower(pa.email) = v_email and pa.approvato = true
  order by pa.created_at desc
  limit 1;

  if public.is_admin() then
    v_nome := coalesce(v_nome, 'Amministrazione Leone Consulting');
    v_ruolo := 'amministratore';
  end if;

  if v_ruolo is null then
    raise exception 'Account non abilitato alle agevolazioni' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.agevolazioni a
    where a.id = p_agevolazione_id
      and a.attiva
      and (a.valid_from is null or a.valid_from <= current_date)
      and (a.valid_until is null or a.valid_until >= current_date)
      and (public.is_admin() or v_ruolo = any(a.ruoli))
  ) then
    raise exception 'Agevolazione non disponibile per questo account' using errcode = '42501';
  end if;

  insert into public.agevolazioni_richieste (
    agevolazione_id, user_id, user_email, nome_utente, ruolo, stato, nota_utente
  ) values (
    p_agevolazione_id, v_uid, v_email, v_nome, v_ruolo, 'richiesta', nullif(left(btrim(coalesce(p_note, '')), 1200), '')
  )
  on conflict (agevolazione_id, user_email) do update
  set user_id = excluded.user_id,
      nome_utente = excluded.nome_utente,
      ruolo = excluded.ruolo,
      nota_utente = excluded.nota_utente,
      stato = case
        when public.agevolazioni_richieste.stato in ('richiesta','in_lavorazione','attiva') then public.agevolazioni_richieste.stato
        else 'richiesta'
      end,
      requested_at = case
        when public.agevolazioni_richieste.stato in ('richiesta','in_lavorazione','attiva') then public.agevolazioni_richieste.requested_at
        else now()
      end
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.richiedi_agevolazione(uuid, text) from public, anon;
grant execute on function public.richiedi_agevolazione(uuid, text) to authenticated;

insert into public.agevolazioni
  (slug, nome, fornitore, descrizione, istruzioni, info_url, ruoli, ordinamento)
values
  ('italo_corporate', 'Italo Corporate', 'Italo',
   'Programma aziendale per i viaggi in treno e i vantaggi riservati al personale delle aziende aderenti.',
   'Richiedi l’attivazione. Se possiedi gia Italo Piu, non creare un doppio account: l’amministrazione ti indichera come associare l’e-mail aziendale.',
   'https://www.italotreno.com/italo-corporate', array['procacciatore','docente','dipendente']::text[], 10),
  ('trenitalia_business', 'Trenitalia for Business', 'Trenitalia',
   'Utenza business nominativa per gestire i viaggi di lavoro insieme al proprio profilo personale.',
   'Richiedi l’attivazione. Dopo l’abilitazione potrai aggiungere l’account Business nell’app Trenitalia senza sostituire il profilo personale.',
   'https://www.trenitalia.com/it/trenitalia-for-business.html', array['procacciatore','docente','dipendente']::text[], 20),
  ('metro_autorizzato', 'METRO · Acquirente autorizzato', 'METRO Italia',
   'Accesso nominativo come persona autorizzata agli acquisti per l’azienda Leone Consulting.',
   'Richiedi l’attivazione. L’amministrazione inviera l’invito personale; non vengono condivise credenziali aziendali.',
   'https://www.metro.it/tessera-metro/diventa-cliente-metro', array['procacciatore','docente','dipendente']::text[], 30)
on conflict (slug) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agevolazioni'
  ) then
    alter publication supabase_realtime add table public.agevolazioni;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agevolazioni_richieste'
  ) then
    alter publication supabase_realtime add table public.agevolazioni_richieste;
  end if;
end $$;
