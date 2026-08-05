#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

ADMIN_ADDRESS="0x312B452bFb7a5d61498f9F4682b644EcD46a5B97"
RPC_URL="https://polygon.drpc.org"
EXPLORER_URL="https://polygonscan.com"

cleanup() {
  unset NFT_DEPLOYER_PRIVATE_KEY NFT_RPC_URL NFT_ADMIN_ADDRESS NFT_MINTER_ADDRESS
  unset NFT_REQUIRE_CONFIRMATION EXPECTED_WALLET_ADDRESS
}
trap cleanup EXIT INT TERM

echo "Leone Consulting · Pubblicazione NFT su Polygon Mainnet"
echo "ADMIN: $ADMIN_ADDRESS"
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Errore: servono Node.js e npm."
  exit 1
fi

IFS= read -r -p "Indirizzo pubblico 0x dell'account Leone NFT Minter: " MINTER_ADDRESS
if [[ ! "$MINTER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Errore: indirizzo MINTER non valido."
  exit 1
fi

if [ "$(printf '%s' "$MINTER_ADDRESS" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$ADMIN_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "Errore: per Mainnet il MINTER deve essere diverso dall'ADMIN."
  echo "Crea gratuitamente un secondo account MetaMask chiamato Leone NFT Minter e riprova."
  exit 1
fi

echo "Preparazione e compilazione del contratto..."
npm ci
npm run compile
echo

IFS= read -r -s -p "Chiave privata dell'account ADMIN (non verrà mostrata né salvata): " NFT_DEPLOYER_PRIVATE_KEY
echo

if [[ ! "$NFT_DEPLOYER_PRIVATE_KEY" =~ ^(0x)?[0-9a-fA-F]{64}$ ]]; then
  echo "Errore: la chiave privata non ha un formato valido."
  exit 1
fi

if [[ "$NFT_DEPLOYER_PRIVATE_KEY" != 0x* ]]; then
  NFT_DEPLOYER_PRIVATE_KEY="0x$NFT_DEPLOYER_PRIVATE_KEY"
fi

export NFT_DEPLOYER_PRIVATE_KEY
export NFT_RPC_URL="$RPC_URL"
export NFT_ADMIN_ADDRESS="$ADMIN_ADDRESS"
export NFT_MINTER_ADDRESS="$MINTER_ADDRESS"
export NFT_REQUIRE_CONFIRMATION="1"
export EXPECTED_WALLET_ADDRESS="$ADMIN_ADDRESS"

node --input-type=module <<'NODE'
import { JsonRpcProvider, Wallet, formatEther, getAddress } from "ethers";

const provider = new JsonRpcProvider(process.env.NFT_RPC_URL);
const network = await provider.getNetwork();
if (network.chainId !== 137n) throw new Error(`Rete errata: chain ID ${network.chainId}.`);

const wallet = new Wallet(process.env.NFT_DEPLOYER_PRIVATE_KEY);
const expected = getAddress(process.env.EXPECTED_WALLET_ADDRESS.toLowerCase());
if (wallet.address !== expected) {
  throw new Error(`La chiave appartiene a ${wallet.address}, non all'ADMIN Leone Consulting ${expected}.`);
}

const balance = await provider.getBalance(wallet.address);
console.log(`Wallet verificato. Saldo Polygon Mainnet: ${formatEther(balance)} POL`);
NODE

unset EXPECTED_WALLET_ADDRESS
echo
echo "ATTENZIONE: la prossima fase usa POL reali su Polygon Mainnet."
echo "Il costo massimo verrà mostrato prima dell'invio."
echo
npm run deploy
echo
echo "Contratto pubblicato su Polygon Mainnet."
echo "Copia contract_address e transaction_hash mostrati sopra."
echo "Explorer: $EXPLORER_URL"
echo
read -r -p "Premi Invio per chiudere."
