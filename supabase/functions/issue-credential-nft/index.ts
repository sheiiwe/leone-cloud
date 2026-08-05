import { createClient } from "npm:@supabase/supabase-js@2";
import { Contract, JsonRpcProvider, Wallet, getBytes } from "npm:ethers@6.17.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const contractAbi = [
  "function mintCredential(address custodian, bytes32 commitment, string metadataUri) returns (uint256)",
  "function revokeCredential(uint256 tokenId, bytes32 reasonHash)",
  "event CredentialMinted(uint256 indexed tokenId, bytes32 indexed commitment, address indexed custodian)",
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const sha256 = async (value: string) => hex(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
);

const asImage = (id?: string | null) => id ? { id, type: "Image" } : undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Endpoint pubblico per i metadata NFT. I dati arrivano dalla RPC con whitelist.
  if (req.method === "GET") {
    const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
    if (!code) return json({ error: "Codice mancante" }, 400);

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await publicClient.rpc("verify_leone_asset", { p_code: code });
    if (error) return json({ error: "Verifica non disponibile" }, 503);
    if (!data?.found || data.kind !== "credential") return json({ error: "Credential non trovato" }, 404);

    return json({
      name: `${data.achievement_name} · ${data.code}`,
      description: data.description || "Certificato digitale verificabile emesso da Leone Consulting",
      image: data.badge_image_url,
      external_url: `https://verifica.leoneconsultingitalia.it/${encodeURIComponent(data.code)}`,
      attributes: [
        { trait_type: "Emittente", value: data.issuer_name },
        { trait_type: "Codice", value: data.code },
        ...(data.certificate_type && data.certificate_type !== "formazione"
          ? [
              { trait_type: "Ruolo / rapporto", value: data.role || data.achievement_name },
              ...(data.relationship_start ? [{ trait_type: "Rapporto dal", value: data.relationship_start }] : []),
              ...(data.relationship_end ? [{ trait_type: "Rapporto fino al", value: data.relationship_end }] : []),
            ]
          : []),
        { trait_type: "Rete", value: data.nft?.network ?? "polygon" },
        { trait_type: "Trasferibile", value: "No" },
      ],
      properties: {
        credential_hash: data.open_badge_hash,
        credential_type: "OpenBadgeCredential",
        certificate_type: data.certificate_type ?? "formazione",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "Metodo non supportato" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Autenticazione richiesta" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(
    authorization.slice("Bearer ".length),
  );
  if (userError || !userData.user) return json({ error: "Sessione non valida" }, 401);

  let credentialId = "";
  let action = "mint";
  let revocationReason = "";
  try {
    const body = await req.json();
    credentialId = String(body.credential_id ?? "");
    action = String(body.action ?? "mint");
    revocationReason = String(body.reason ?? "").trim();
  } catch {
    return json({ error: "Corpo richiesta non valido" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(credentialId)) return json({ error: "ID credential non valido" }, 400);

  // Questa SELECT passa dalle RLS: soltanto un amministratore dei credential procede.
  const { data: credential, error: credentialError } = await userClient
    .from("credentials")
    .select("*")
    .eq("id", credentialId)
    .single();
  if (credentialError || !credential) return json({ error: "Credential non trovato o non autorizzato" }, 403);
  const rpcUrl = Deno.env.get("NFT_RPC_URL") ?? "";
  const privateKey = Deno.env.get("NFT_PRIVATE_KEY") ?? "";
  const contractAddress = Deno.env.get("NFT_CONTRACT_ADDRESS") ?? "";
  const custodianAddress = Deno.env.get("NFT_CUSTODIAN_ADDRESS") ?? "";
  const chainId = Number(Deno.env.get("NFT_CHAIN_ID") ?? "137");
  const network = Deno.env.get("NFT_NETWORK") ?? (chainId === 137 ? "polygon" : "polygon-amoy");
  const explorerBase = (Deno.env.get("NFT_EXPLORER_BASE")
    ?? (chainId === 137 ? "https://polygonscan.com" : "https://amoy.polygonscan.com")).replace(/\/$/, "");

  if (!rpcUrl || !privateKey || !contractAddress || !custodianAddress) {
    return json({
      error: "Minting non configurato",
      required: ["NFT_RPC_URL", "NFT_PRIVATE_KEY", "NFT_CONTRACT_ADDRESS", "NFT_CUSTODIAN_ADDRESS"],
    }, 503);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (action === "revoke") {
    if (credential.nft_status !== "minted" || !credential.nft_token_id) {
      return json({ error: "NFT non ancora emesso: revoca on-chain non possibile" }, 409);
    }
    if (!revocationReason) return json({ error: "Motivo della revoca obbligatorio" }, 400);
    try {
      const provider = new JsonRpcProvider(rpcUrl, chainId);
      const issuerWallet = new Wallet(privateKey, provider);
      const contract = new Contract(contractAddress, contractAbi, issuerWallet);
      const reasonHash = await sha256(revocationReason);
      const tx = await contract.revokeCredential(BigInt(credential.nft_token_id), `0x${reasonHash}`);
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Revoca non confermata");
      const { error: revokeError } = await serviceClient.from("credentials").update({
        status: "revoked",
        status_reason: revocationReason.slice(0, 500),
        nft_status: "revoked",
        nft_revocation_tx_hash: receipt.hash,
        nft_revoked_at: new Date().toISOString(),
      }).eq("id", credential.id);
      if (revokeError) throw revokeError;
      return json({ ok: true, revoked: true, code: credential.verification_code, tx_hash: receipt.hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore durante la revoca";
      return json({ error: message }, 500);
    }
  }

  if (action !== "mint") return json({ error: "Azione non supportata" }, 400);
  if (credential.nft_status === "minted") return json({ error: "NFT già emesso", credential }, 409);
  if (["revoked", "suspended"].includes(credential.status)) return json({ error: "Credential non emettibile nello stato corrente" }, 409);

  try {
    const provider = new JsonRpcProvider(rpcUrl, chainId);
    const issuerWallet = new Wallet(privateKey, provider);
    const verificationUrl = `https://verifica.leoneconsultingitalia.it/${encodeURIComponent(credential.verification_code)}`;
    const credentialUrl = `${verificationUrl}#open-badge`;
    const issuedAt = new Date(credential.issued_at).toISOString();

    const unsignedBadge: Record<string, unknown> = {
      "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
      ],
      id: credentialUrl,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      name: credential.achievement_name,
      issuer: {
        id: credential.issuer_mode === "partner"
          ? `${credentialUrl}#issuer-profile`
          : "https://leoneconsultingitalia.it/#issuer",
        type: ["Profile"],
        name: credential.issuer_name,
      },
      validFrom: issuedAt,
      ...(credential.expires_at ? { validUntil: new Date(credential.expires_at).toISOString() } : {}),
      credentialSubject: {
        id: `urn:uuid:${credential.id}`,
        type: ["AchievementSubject"],
        identifier: [{
          type: "IdentityObject",
          identityHash: credential.recipient_identifier_hash,
          identityType: credential.recipient_email ? "emailAddress" : "identifier",
          hashed: true,
        }],
        achievement: {
          id: `${credentialUrl}#achievement`,
          type: ["Achievement"],
          achievementType: credential.achievement_type || "Course",
          name: credential.achievement_name,
          description: credential.description || credential.achievement_name,
          criteria: { narrative: credential.criteria || "Completamento dei requisiti previsti" },
          ...(credential.skills?.length ? { tag: credential.skills } : {}),
          ...(credential.badge_image_url ? { image: asImage(credential.badge_image_url) } : {}),
          ...(credential.partner_name ? {
            creator: {
              id: `${credentialUrl}#partner-profile`,
              type: ["Profile"],
              name: credential.partner_name,
            },
          } : {}),
        },
        ...(credential.evidence_url ? {
          evidence: [{
            id: credential.evidence_url,
            type: ["Evidence"],
            name: "Evidenza del risultato",
          }],
        } : {}),
      },
      credentialSchema: [{
        id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
        type: "1EdTechJsonSchemaValidator2019",
      }],
    };

    const unsignedHash = await sha256(JSON.stringify(unsignedBadge));
    const proofValue = await issuerWallet.signMessage(getBytes(`0x${unsignedHash}`));
    const openBadge = {
      ...unsignedBadge,
      proof: [{
        type: "EthereumEip191Signature2021",
        created: issuedAt,
        verificationMethod: `eip155:${chainId}:${issuerWallet.address}`,
        proofPurpose: "assertionMethod",
        proofValue,
      }],
    };
    const badgeHash = await sha256(JSON.stringify(openBadge));
    const tokenUri = `${supabaseUrl}/functions/v1/issue-credential-nft?code=${encodeURIComponent(credential.verification_code)}`;

    await serviceClient.from("credentials").update({ nft_status: "minting" }).eq("id", credential.id);

    const contract = new Contract(contractAddress, contractAbi, issuerWallet);
    const tx = await contract.mintCredential(custodianAddress, `0x${badgeHash}`, tokenUri);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transazione non confermata");

    let tokenId = "";
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "CredentialMinted") tokenId = parsed.args.tokenId.toString();
      } catch {
        // Evento di un altro contratto: ignorato.
      }
    }
    if (!tokenId) throw new Error("Token ID non trovato nella ricevuta");

    const update = {
      open_badge: openBadge,
      open_badge_hash: badgeHash,
      blockchain_network: network,
      nft_status: "minted",
      nft_contract: contractAddress.toLowerCase(),
      nft_token_id: tokenId,
      nft_tx_hash: receipt.hash,
      nft_explorer_url: `${explorerBase}/tx/${receipt.hash}`,
      nft_token_uri: tokenUri,
      nft_owner_wallet: custodianAddress.toLowerCase(),
      nft_minted_at: new Date().toISOString(),
      status: "valid",
      status_reason: null,
    };
    const { error: updateError } = await serviceClient.from("credentials").update(update).eq("id", credential.id);
    if (updateError) throw updateError;

    return json({ ok: true, code: credential.verification_code, token_id: tokenId, tx_hash: receipt.hash });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore di minting";
    await serviceClient.from("credentials").update({
      nft_status: "failed",
      status: "pending_nft",
      status_reason: message.slice(0, 500),
    }).eq("id", credential.id);
    return json({ error: message }, 500);
  }
});
