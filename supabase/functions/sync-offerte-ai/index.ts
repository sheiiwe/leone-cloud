// Leone Consulting - Sincronizzazione offerte con AI
// Legge i fogli Google dell'azienda, li interpreta con Claude e aggiorna la tabella "offerte".
// Richiamabile dall'app/portale (POST) e da pg_cron (giornaliero).
// Secret richiesto: ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHEET_ID = '1kOvepVi-yJ1fdBY1-Lyv_bGFICeTxFvW'
const TABS = [
  { gid: '2060193380', tipo: 'scadenze' },
  { gid: '1423287524', tipo: 'prodotti' },
  { gid: '727617356',  tipo: 'prodotti' },
  { gid: '926437199',  tipo: 'prodotti' },
  { gid: '1964914127', tipo: 'prodotti' },
  { gid: '1386426593', tipo: 'prodotti' },
  { gid: '1230826695', tipo: 'prodotti' },
  { gid: '169737463',  tipo: 'prodotti' },
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY non impostata nei Secrets di Supabase')
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1) Scarica tutte le schede del foglio
    let fogli = ''
    for (const t of TABS) {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${t.gid}`
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const csv = await r.text()
      fogli += `\n\n===== SCHEDA ${t.tipo} (gid ${t.gid}) =====\n` + csv.slice(0, 18000)
    }

    // 2) Fai interpretare i fogli a Claude
    const oggi = new Date().toISOString().slice(0, 10)
    const prompt = `Sei un assistente che legge i fogli Google di un'azienda di consulenza energia/telefonia e ne ricava il catalogo offerte pulito.

Oggi è ${oggi}.

Qui sotto trovi piu schede in formato CSV. La scheda "scadenze" contiene le date di scadenza (CTE) per fornitore/offerta. Le altre schede "prodotti" contengono le offerte (luce, gas, business, telefonia) con nome, costo, canone annuo (PCV), note, fatturazione, ecc.

Producimi SOLO un array JSON (nessun testo prima o dopo, niente markdown, nessuna spiegazione) di oggetti offerta con questi campi (stringhe):
- cat: una tra "Luce Fisso","Luce Variabile","Gas Fisso","Gas Variabile","Business","Telefonia Fissa","Telefonia Mobile"
- forn: fornitore (es. Enel, Plenitude, Acea, Iren, Edison, Engie, Illumia, Volty, Fastweb, TIM, Eni)
- nome: nome offerta
- prezzo: prezzo/spread principale (es. "0,149 €/kWh")
- pcv: canone/quota annua (es. "144 €")
- validita: durata (es. "12 mesi")
- fatt: fatturazione (es. "Mensile")
- scad: data di scadenza in formato YYYY-MM-DD. Abbina dalla scheda scadenze al fornitore/offerta giusto. Se una riga scadenze e a livello di solo fornitore (es. "Edison", "Enel offerte"), vale per TUTTE le offerte energia (luce/gas/business) di quel fornitore ma NON per la telefonia. Se non c'e scadenza lascia "".
- pagamento: modalita/note pagamento
- azioni: tipo operazione (Switch, Voltura, Subentro...)
- promo: note/promozioni
- giga: solo telefonia, altrimenti ""
- costoAtt: costo attivazione, solo telefonia, altrimenti ""

Mantieni la virgola come separatore decimale, come nei fogli. Includi TUTTE le offerte presenti nelle schede prodotti. Rispondi con il SOLO array JSON.

${fogli}`

    const air = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
    })
    const aj = await air.json()
    if (!air.ok) throw new Error('Anthropic: ' + JSON.stringify(aj).slice(0, 300))
    let txt = (aj.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim()
    const a = txt.indexOf('['), b = txt.lastIndexOf(']')
    if (a < 0 || b < 0) throw new Error('Risposta AI non in formato JSON')
    const offerte = JSON.parse(txt.slice(a, b + 1))
    if (!Array.isArray(offerte) || !offerte.length) throw new Error('Nessuna offerta estratta dai fogli')

    // 3) Aggiorna la tabella offerte (match per fornitore + nome)
    const { data: cur } = await sb.from('offerte').select('id,data')
    const norm = (s: any) => (s || '').toString().trim().toLowerCase()
    const existing = (cur || []).map((x: any) => ({ id: x.id, ...(x.data || {}) }))
    let agg = 0, nuovi = 0, elim = 0
    for (const o of offerte) {
      const ex = existing.find((e: any) => norm(e.forn) === norm(o.forn) && norm(e.nome) === norm(o.nome))
      if (ex) { const { id, ...d } = ex; await sb.from('offerte').update({ data: { ...d, ...o } }).eq('id', ex.id); agg++ }
      else { await sb.from('offerte').insert({ data: o }); nuovi++ }
    }
    // Elimina quelle non piu presenti (solo se l'AI ha letto un numero sensato di offerte)
    if (offerte.length >= 20) {
      for (const e of existing) {
        const ok = offerte.find((o: any) => norm(o.forn) === norm(e.forn) && norm(o.nome) === norm(e.nome))
        if (!ok) { await sb.from('offerte').delete().eq('id', e.id); elim++ }
      }
    }

    return new Response(JSON.stringify({ ok: true, totale: offerte.length, aggiornate: agg, nuove: nuovi, eliminate: elim }),
      { headers: { ...CORS, 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, errore: String((e as any).message || e) }),
      { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }
})
