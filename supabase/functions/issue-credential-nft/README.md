# Edge Function `issue-credential-nft`

La funzione autentica l'amministratore attraverso le RLS, costruisce il
credential Open Badge, firma il suo hash, emette l'NFT non trasferibile e rende
valido il certificato soltanto dopo la conferma della transazione.

Segreti richiesti:

- `NFT_RPC_URL`
- `NFT_PRIVATE_KEY` (wallet con solo `MINTER_ROLE`)
- `NFT_CONTRACT_ADDRESS`
- `NFT_CUSTODIAN_ADDRESS`
- `NFT_CHAIN_ID` (`80002` in collaudo, `137` in produzione)
- `NFT_NETWORK`
- `NFT_EXPLORER_BASE`

Distribuire con verifica JWT disabilitata a livello gateway perché lo stesso
endpoint espone in GET i metadata pubblici del token. La richiesta POST verifica
comunque esplicitamente il JWT e passa dalle RLS.
