# Leone Consulting — Gestionale Procacciatori (Cloud Edition)
## Database condiviso via Supabase — Mac + Windows

### Requisiti
- Node.js 18+ → https://nodejs.org (LTS)

### Avvio rapido
```bash
cd leone-consulting-app
npm install
npm start
```

### Build Mac (.app / DMG)
```bash
npm run build-dir   # crea .app in dist/
npm run build       # crea DMG distribuibile
```

### Build Windows (.exe)
```bash
npm run build-win
```

### Dati cloud
I dati sono su Supabase — qualsiasi Mac o Windows con l'app vede
gli stessi dati in tempo reale. Nessun backup manuale necessario.

**Leone Consulting di Leonardo Angelucci**
Via Pia 42, 00049 Velletri (RM) · P.IVA 18231181001

## Tabella Impostazioni (Supabase)

Esegui questa query SQL nel pannello Supabase → SQL Editor per creare la tabella impostazioni:

```sql
CREATE TABLE IF NOT EXISTS impostazioni (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE impostazioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON impostazioni FOR ALL USING (true) WITH CHECK (true);
```
