-- Un'unica policy SELECT per tabella evita valutazioni RLS duplicate.
-- Le scritture restano consentite soltanto all'amministratore.

revoke all on function private.set_updated_at() from public;

drop policy if exists agevolazioni_admin_all on public.agevolazioni;
drop policy if exists agevolazioni_personale_select on public.agevolazioni;
drop policy if exists agevolazioni_select on public.agevolazioni;
create policy agevolazioni_select on public.agevolazioni
for select to authenticated
using (
  public.is_admin()
  or (
    attiva
    and (valid_from is null or valid_from <= current_date)
    and (valid_until is null or valid_until >= current_date)
    and exists (
      select 1 from unnest(ruoli) as r(ruolo)
      where public.puo_area(r.ruolo)
    )
  )
);
create policy agevolazioni_admin_insert on public.agevolazioni
for insert to authenticated with check (public.is_admin());
create policy agevolazioni_admin_update on public.agevolazioni
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy agevolazioni_admin_delete on public.agevolazioni
for delete to authenticated using (public.is_admin());

drop policy if exists agevolazioni_richieste_admin_all on public.agevolazioni_richieste;
drop policy if exists agevolazioni_richieste_self_select on public.agevolazioni_richieste;
drop policy if exists agevolazioni_richieste_select on public.agevolazioni_richieste;
create policy agevolazioni_richieste_select on public.agevolazioni_richieste
for select to authenticated
using (
  public.is_admin()
  or lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);
create policy agevolazioni_richieste_admin_insert on public.agevolazioni_richieste
for insert to authenticated with check (public.is_admin());
create policy agevolazioni_richieste_admin_update on public.agevolazioni_richieste
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy agevolazioni_richieste_admin_delete on public.agevolazioni_richieste
for delete to authenticated using (public.is_admin());
