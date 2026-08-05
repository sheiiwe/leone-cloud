# Verifica Leone Consulting

Sito unico per verificare tesserini, certificati Open Badge e NFT tramite lo
stesso QR e lo stesso dominio `verifica.leoneconsultingitalia.it`.

## Configurazione

1. Applicare la migration Supabase inclusa nel progetto.
2. In `config.js` inserire URL e chiave **publishable/anon** del progetto
   Supabase. Non usare mai la `service_role`.
3. Pubblicare il contenuto di questa cartella sul progetto Cloudflare Pages già
   collegato al dominio di verifica.
4. Controllare sia un vecchio codice tesserino sia un nuovo codice `LCB-*`.

La pagina interroga soltanto la RPC `verify_leone_asset`: le tabelle non sono
pubbliche e la risposta esclude email, wallet, file privati e dati anagrafici non
necessari.
