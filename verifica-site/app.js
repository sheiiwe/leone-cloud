(() => {
  "use strict";

  const config = window.LEONE_VERIFY_CONFIG || {};
  const form = document.getElementById("verify-form");
  const input = document.getElementById("code");
  const result = document.getElementById("result");
  document.getElementById("year").textContent = String(new Date().getFullYear());

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
  const fmtDate = (value, empty = "Nessuna scadenza") => value
    ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value))
    : empty;
  const labels = {
    valid: "Valido", revoked: "Revocato", suspended: "Sospeso",
    expired: "Scaduto", pending: "In emissione"
  };
  const cleanCode = (value) => decodeURIComponent(String(value ?? ""))
    .trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 80);

  function setBusy(busy) {
    result.setAttribute("aria-busy", String(busy));
    if (busy) result.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Controllo del registro in corso…</p></div>';
  }

  function renderNotFound(code, message = "Nessun tesserino o certificato corrisponde a questo codice.") {
    result.innerHTML = `<div class="not-found"><span class="scan-icon">×</span><h2>Credenziale non trovata</h2><p>${esc(message)}<br><span class="code">${esc(code)}</span></p></div>`;
  }

  function dataUrl(value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/ld+json" });
    return URL.createObjectURL(blob);
  }

  function detail(label, value) {
    return `<div class="detail"><small>${esc(label)}</small><strong>${esc(value || "—")}</strong></div>`;
  }

  function renderCredential(data) {
    const status = data.status in labels ? data.status : "pending";
    const isCredential = data.kind === "credential";
    const isRelationship = isCredential && Boolean(data.certificate_type) && data.certificate_type !== "formazione";
    const nft = data.nft || {};
    const badgeReady = Boolean(data.open_badge && data.open_badge_hash);
    const nftReady = nft.status === "minted" && nft.transaction_hash;
    const partner = data.partner_name
      ? `${data.issuer_name} · ${data.partner_name}`
      : data.issuer_name;
    const openBadgeHref = badgeReady ? dataUrl(data.open_badge) : "";
    const explorerHref = nftReady && /^https:\/\//.test(nft.explorer_url || "") ? nft.explorer_url : "";

    result.innerHTML = `
      <article class="result-card">
        <header class="result-head">
          <div>
            <span class="kind">${isCredential ? "Certificato NFT" : "Tesserino aziendale"}</span>
            <h2>${esc(isCredential ? data.achievement_name : data.holder_name)}</h2>
            <span class="code">${esc(data.code)}</span>
          </div>
          <span class="status-pill status-${esc(status)}">${esc(labels[status])}</span>
        </header>
        <div class="details-grid">
          ${detail(isCredential ? (data.subject_type === "azienda" ? "Azienda" : "Titolare") : "Nome", data.holder_name)}
          ${detail(isCredential ? "Emittente" : "Ruolo", isCredential ? partner : data.role)}
          ${isRelationship ? detail("Ruolo / rapporto", data.role || data.achievement_name) : ""}
          ${isRelationship ? detail("Rapporto dal", fmtDate(data.relationship_start, "Non indicato")) : detail("Data di emissione", fmtDate(data.issued_at, "Non disponibile"))}
          ${isRelationship ? detail("Rapporto fino al", fmtDate(data.relationship_end, "In corso")) : detail("Scadenza", fmtDate(data.expires_at))}
          ${isCredential ? detail("Tipo", isRelationship ? "Certificato NFT" : "Open Badge 3.0 + NFT") : detail("Tipo", "Tesserino Leone Consulting")}
          ${detail("Verifica", data.valid ? "Autentico e in corso di validità" : labels[status])}
        </div>
        ${data.description ? `<p class="description">${esc(data.description)}</p>` : ""}
        ${isCredential ? `
          <div class="proofs">
            <section class="proof">
              <div class="proof-top"><span class="proof-icon">✓</span><h3>Certificato</h3></div>
              <p>Stato amministrativo aggiornato in tempo reale nel registro dell'emittente.</p>
              <span class="proof-state ${data.valid ? "" : "pending"}">${esc(labels[status])}</span>
            </section>
            <section class="proof">
              <div class="proof-top"><span class="proof-icon">OB</span><h3>Open Badge</h3></div>
              <p>${isRelationship ? "Credential firmata che attesta il rapporto indicato dall'emittente." : "Credential verificabile con risultato, criteri, competenze e firma dell'emittente."}</p>
              ${badgeReady
                ? `<a class="button secondary" id="download-badge" href="${openBadgeHref}" download="${esc(data.code)}-open-badge.json">Scarica Open Badge</a>`
                : '<span class="proof-state pending">In preparazione</span>'}
            </section>
            <section class="proof">
              <div class="proof-top"><span class="proof-icon">N</span><h3>NFT non trasferibile</h3></div>
              <p>${nftReady ? `Token #${esc(nft.token_id)} · ${esc(nft.network)}` : "La prova blockchain è obbligatoria prima dell'attivazione."}</p>
              ${explorerHref
                ? `<a class="button secondary" href="${esc(explorerHref)}" target="_blank" rel="noopener noreferrer">Apri transazione</a>`
                : '<span class="proof-state pending">In emissione</span>'}
            </section>
          </div>` : ""}
      </article>`;
  }

  async function verify(rawCode, pushState = true) {
    const code = cleanCode(rawCode);
    if (!code) return;
    input.value = code;
    if (pushState) history.replaceState(null, "", `/${encodeURIComponent(code)}`);
    setBusy(true);

    if (!/^https:\/\//.test(config.supabaseUrl || "") || !config.supabasePublishableKey || config.supabasePublishableKey.startsWith("__")) {
      renderNotFound(code, "Servizio non ancora configurato: impostare URL e chiave publishable di Supabase.");
      return;
    }

    try {
      const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/verify_leone_asset`, {
        method: "POST",
        headers: {
          apikey: config.supabasePublishableKey,
          Authorization: `Bearer ${config.supabasePublishableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_code: code }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.found) renderNotFound(code);
      else renderCredential(data);
    } catch (error) {
      console.error(error);
      renderNotFound(code, "Il registro non è momentaneamente raggiungibile. Riprova tra poco.");
    } finally {
      result.setAttribute("aria-busy", "false");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    verify(input.value);
  });

  const initial = cleanCode(location.pathname.split("/").filter(Boolean).pop() || new URLSearchParams(location.search).get("code"));
  if (initial && !["INDEX.HTML", "APP.JS", "STYLES.CSS"].includes(initial)) verify(initial, false);
})();
