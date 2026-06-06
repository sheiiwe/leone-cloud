"""
Generatore PDF — Leone Consulting
Prospetto Compensi Procacciatori + Busta Paga Dipendenti
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
import os, sys, json
from datetime import datetime

W, H = A4
LOGO = os.path.join(os.path.dirname(__file__), 'assets', 'icon.png')

# ── COLORI ────────────────────────────────────────────────────
BLUE      = colors.HexColor('#185FA5')
BLUE_DARK = colors.HexColor('#0C447C')
BLUE_LITE = colors.HexColor('#E6F1FB')
RED       = colors.HexColor('#CC0000')
GRAY_HDR  = colors.HexColor('#2C3E50')
GRAY_ROW  = colors.HexColor('#F5F5F0')
GRAY_LINE = colors.HexColor('#CCCCCC')
WHITE     = colors.white
BLACK     = colors.HexColor('#1A1A18')

def fmtE(n):
    """Formatta importo in euro"""
    try:
        n = float(n or 0)
        return f"€ {n:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    except:
        return "€ —"

def draw_logo(c, x, y, size=14*mm):
    """Disegna logo LC"""
    try:
        c.drawImage(LOGO, x, y - size, width=size, height=size, mask='auto', preserveAspectRatio=True)
    except:
        # Fallback: cerchio con LC
        c.setFillColor(BLUE)
        c.circle(x + size/2, y - size/2, size/2, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 9)
        c.drawCentredString(x + size/2, y - size/2 - 3, 'LC')

def header_section(c, y, title, subtitle=''):
    """Intestazione documento con logo"""
    # Sfondo header
    c.setFillColor(BLUE)
    c.rect(0, y - 28*mm, W, 28*mm, fill=1, stroke=0)

    # Logo
    draw_logo(c, 14*mm, y - 7*mm, 14*mm)

    # Titolo
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 16)
    c.drawString(32*mm, y - 14*mm, title)

    # Sottotitolo
    if subtitle:
        c.setFont('Helvetica', 9)
        c.drawString(32*mm, y - 21*mm, subtitle)

    return y - 30*mm

def section_bar(c, x, y, w, h, text, bg=GRAY_HDR, fg=WHITE):
    """Barra sezione"""
    c.setFillColor(bg)
    c.rect(x, y - h, w, h, fill=1, stroke=0)
    c.setFillColor(fg)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(x + 3*mm, y - h + 2.5*mm, text.upper())
    return y - h

def cell_label(c, x, y, w, h, label, value='', label_size=6.5, value_size=9, border=True):
    """Cella con etichetta sopra e valore sotto"""
    if border:
        c.setStrokeColor(GRAY_LINE)
        c.setLineWidth(0.4)
        c.rect(x, y - h, w, h, fill=0, stroke=1)

    # Label piccola
    c.setFillColor(colors.HexColor('#6B6B66'))
    c.setFont('Helvetica', label_size)
    c.drawString(x + 2*mm, y - 4*mm, label)

    # Valore
    if value:
        c.setFillColor(BLACK)
        c.setFont('Helvetica-Bold' if value_size >= 9 else 'Helvetica', value_size)
        # Tronca se troppo lungo
        max_chars = int(w / (value_size * 0.45))
        val = str(value)[:max_chars] if len(str(value)) > max_chars else str(value)
        c.drawString(x + 2*mm, y - h + 2.5*mm, val)

def line_h(c, x1, x2, y, color=GRAY_LINE, width=0.4):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1, y, x2, y)

def line_v(c, x, y1, y2, color=GRAY_LINE, width=0.4):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x, y1, x, y2)

# ══════════════════════════════════════════════════════════════
# PROSPETTO COMPENSI — PARTITA IVA
# ══════════════════════════════════════════════════════════════

def genera_prospetto_piva(dati, output_path):
    """
    dati: dict con procacciatore, vendite, calcoli
    """
    p = dati.get('procacciatore', {})
    v = dati.get('vendite', [])
    calc = dati.get('calcoli', {})
    mese = dati.get('mese', '')

    c = canvas.Canvas(output_path, pagesize=A4)
    c.setAuthor('Leone Consulting di Leonardo Angelucci')
    c.setTitle(f'Prospetto Compensi P.IVA — {p.get("nome","")} — {mese}')

    y = H - 10*mm

    # ── HEADER ──
    y = header_section(c,
        y,
        'PROSPETTO COMPENSI – PROCACCIATORE D\'AFFARI',
        'Regime: Titolare di Partita IVA  |  Art. 1742 c.c. – D.Lgs. 303/1991'
    )
    y -= 3*mm

    margin = 13*mm
    content_w = W - 2 * margin

    # ── DATI AZIENDA MANDANTE ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI AZIENDA MANDANTE')
    # Riga 1
    rh = 10*mm
    cell_label(c, margin, y, content_w*0.45, rh, 'RAGIONE SOCIALE / DENOMINAZIONE', 'Leone Consulting di Leonardo Angelucci', value_size=8)
    cell_label(c, margin + content_w*0.45, y, content_w*0.25, rh, 'CODICE FISCALE / P.IVA', '18231181001')
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'SEDE LEGALE', 'Via Pia 42')
    y -= rh
    # Riga 2
    cell_label(c, margin, y, content_w*0.45, rh, 'SEDE OPERATIVA', 'Viale Guglielmo Oberdan 22')
    cell_label(c, margin + content_w*0.45, y, content_w*0.25, rh, 'CITTÀ / PROVINCIA / CAP', 'Velletri (RM) 00049')
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'TELEFONO', '379 126 4864')
    y -= rh
    # Riga 3
    cell_label(c, margin, y, content_w, 8*mm, 'EMAIL', 'amministrazione@leoneconsultingitalia.it')
    y -= 8*mm

    y -= 2*mm

    # ── DATI PROCACCIATORE ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI PROCACCIATORE D\'AFFARI')
    rh = 10*mm
    cell_label(c, margin, y, content_w*0.45, rh, 'COGNOME E NOME', p.get('nome', ''))
    cell_label(c, margin + content_w*0.45, y, content_w*0.30, rh, 'CODICE FISCALE', p.get('cf', ''))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'DATA DI NASCITA', p.get('nascita', ''))
    y -= rh
    cell_label(c, margin, y, content_w*0.40, rh, 'RESIDENZA / DOMICILIO', p.get('indirizzo', ''))
    cell_label(c, margin + content_w*0.40, y, content_w*0.35, rh, 'CITTÀ / CAP / PROVINCIA', p.get('citta', ''))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'TELEFONO / EMAIL', p.get('tel', '') + ('  ' + p.get('email', '') if p.get('email') else ''), value_size=7)
    y -= rh
    cell_label(c, margin, y, content_w*0.35, rh, 'PARTITA IVA', p.get('cf', ''))
    cell_label(c, margin + content_w*0.35, y, content_w*0.35, rh, 'REGIME FISCALE', 'Ordinario / Forfettario')
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'CODICE ATECO', p.get('ateco', ''))
    y -= rh

    y -= 2*mm

    # ── DATI CONTRATTO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI CONTRATTO / INCARICO E PERIODO DI COMPETENZA')
    rh = 9*mm
    cw4 = content_w / 4
    cell_label(c, margin, y, cw4, rh, 'N° CONTRATTO / INCARICO', dati.get('n_contratto', ''))
    cell_label(c, margin + cw4, y, cw4, rh, 'DATA INIZIO INCARICO', p.get('inizio', ''))
    cell_label(c, margin + cw4*2, y, cw4, rh, 'DATA FINE INCARICO', p.get('fine', ''))
    cell_label(c, margin + cw4*3, y, cw4, rh, 'ZONA / AREA GEOGRAFICA', dati.get('zona', 'Italia'))
    y -= rh
    cell_label(c, margin, y, content_w*0.50, rh, 'PRODOTTO / SERVIZIO OGGETTO DEL CONTRATTO', dati.get('prodotto', ''))
    cell_label(c, margin + content_w*0.50, y, content_w*0.25, rh, '% PROVVIGIONE BASE', str(calc.get('prov_pct', '')) + '%')
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, '% PROVVIGIONE SUPERPREMIO', '')
    y -= rh
    cell_label(c, margin, y, content_w*0.30, rh, 'MESE / PERIODO', mese)
    cell_label(c, margin + content_w*0.30, y, content_w*0.15, rh, 'ANNO', mese[:4] if mese else '')
    cell_label(c, margin + content_w*0.45, y, content_w*0.30, rh, 'DATA EMISSIONE PROSPETTO', datetime.now().strftime('%d/%m/%Y'))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'N° PROSPETTO', dati.get('n_prospetto', ''))
    y -= rh

    y -= 2*mm

    # ── DETTAGLIO AFFARI ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DETTAGLIO AFFARI PROCACCIATI NEL PERIODO')

    # Header tabella
    th = 7*mm
    c.setFillColor(BLUE)
    c.rect(margin, y - th, content_w, th, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    cols_x = [margin, margin+8*mm, margin+8*mm+content_w*0.38, margin+8*mm+content_w*0.38+content_w*0.35, W-margin-30*mm]
    headers = ['N°', 'Cliente / Controparte', 'Descrizione', '% Provv.', 'Provvigione Lorda (€)']
    cols_w = [8*mm, content_w*0.38, content_w*0.35, W-margin-30*mm-(margin+8*mm+content_w*0.38+content_w*0.35-margin), 30*mm]
    for i, (hx, ht) in enumerate(zip(cols_x, headers)):
        c.drawString(hx + 2*mm, y - th + 2*mm, ht)
    y -= th

    # Righe vendite (max 6)
    row_h = 8*mm
    for i in range(6):
        bg = GRAY_ROW if i % 2 == 0 else WHITE
        c.setFillColor(bg)
        c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
        # Bordi
        c.setStrokeColor(GRAY_LINE)
        c.setLineWidth(0.3)
        c.rect(margin, y - row_h, content_w, row_h, fill=0, stroke=1)

        c.setFillColor(colors.HexColor('#6B6B66'))
        c.setFont('Helvetica', 7.5)
        c.drawString(margin + 2*mm, y - row_h/2 - 2*mm, str(i+1))

        if i < len(v):
            vend = v[i]
            c.setFillColor(BLACK)
            c.setFont('Helvetica', 7.5)
            cliente = str(vend.get('cliente', ''))[:35]
            desc = str(vend.get('prod', ''))[:40]
            prov_pct = f"{vend.get('prov_pct', '')}%"
            prov_val = fmtE(vend.get('prov', 0))
            c.drawString(margin + 10*mm, y - row_h/2 - 2*mm, cliente)
            c.drawString(margin + 10*mm + content_w*0.38, y - row_h/2 - 2*mm, desc)
            c.drawRightString(W - margin - 32*mm, y - row_h/2 - 2*mm, prov_pct)
            c.drawRightString(W - margin - 2*mm, y - row_h/2 - 2*mm, prov_val)
        y -= row_h

    # Riga TOTALE
    c.setFillColor(BLUE_LITE)
    c.rect(margin, y - 8*mm, content_w, 8*mm, fill=1, stroke=0)
    c.setStrokeColor(GRAY_LINE)
    c.rect(margin, y - 8*mm, content_w, 8*mm, fill=0, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica-Bold', 8.5)
    c.drawString(margin + 2*mm, y - 5.5*mm, 'TOTALE')
    c.drawRightString(W - margin - 2*mm, y - 5.5*mm, fmtE(calc.get('totale_lordo', 0)))
    y -= 8*mm + 2*mm

    # ── CALCOLO COMPENSO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'CALCOLO COMPENSO')

    # Header tabella calcolo
    th = 7*mm
    c.setFillColor(BLUE)
    c.rect(margin, y - th, content_w, th, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(margin + 2*mm, y - th + 2*mm, 'VOCE')
    c.drawString(margin + content_w*0.55, y - th + 2*mm, 'IMPORTO (€)')
    c.drawString(margin + content_w*0.72, y - th + 2*mm, 'NOTE / RIF. NORMATIVO')
    y -= th

    totale_lordo = float(calc.get('totale_lordo', 0))
    rimborsi = float(calc.get('rimborsi', 0))
    imponibile_iva = totale_lordo + rimborsi
    iva = imponibile_iva * 0.22
    ritenuta = imponibile_iva * 0.115
    totale_netto = imponibile_iva + iva - ritenuta

    voci = [
        ('Totale Provvigioni Lorde', fmtE(totale_lordo), '', False),
        ('Eventuali Rimborsi Spese Documentati', '+' + fmtE(rimborsi) if rimborsi else '+ € —', 'Esenti IVA se rimborsate a piè di lista', False),
        ('Imponibile IVA', fmtE(imponibile_iva), '', False),
        ('IVA (aliquota 22%)', '+' + fmtE(iva), 'Art. 1 DPR 633/72 – op. imponibile', False),
        ('Ritenuta d\'Acconto IRPEF (23% su 50% impon.)', '-' + fmtE(ritenuta), 'Art. 25-bis DPR 600/73 – effettivo 11,5%', False),
        ('TOTALE DA RICEVERE (netto fattura)', fmtE(totale_netto), '', True),
    ]

    for voce, importo, nota, is_total in voci:
        row_h = 9*mm
        if is_total:
            c.setFillColor(BLUE)
            c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 8.5)
        else:
            c.setFillColor(GRAY_ROW if voci.index((voce, importo, nota, is_total)) % 2 == 0 else WHITE)
            c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
            c.setFillColor(BLACK)
            c.setFont('Helvetica', 8)
        c.setStrokeColor(GRAY_LINE)
        c.rect(margin, y - row_h, content_w, row_h, fill=0, stroke=1)
        c.drawString(margin + 2*mm, y - 6*mm, voce)
        if is_total:
            c.setFont('Helvetica-Bold', 9)
        c.drawString(margin + content_w*0.55, y - 6*mm, importo)
        c.setFont('Helvetica', 7)
        c.setFillColor(colors.HexColor('#6B6B66') if not is_total else WHITE)
        c.drawString(margin + content_w*0.72, y - 6*mm, nota)
        y -= row_h

    y -= 2*mm

    # ── DATI PAGAMENTO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI PAGAMENTO')
    rh = 9*mm
    cell_label(c, margin, y, content_w*0.25, rh, 'MODALITÀ DI PAGAMENTO', 'Bonifico Bancario')
    cell_label(c, margin + content_w*0.25, y, content_w*0.25, rh, 'DATA PREVISTA PAGAMENTO', dati.get('data_pagamento', ''))
    cell_label(c, margin + content_w*0.50, y, content_w*0.50, rh, 'IBAN / RIFERIMENTO BANCARIO', p.get('iban', ''))
    y -= rh + 2*mm

    # ── NOTE ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'NOTE E DICHIARAZIONI')
    nota_h = 16*mm
    c.setFillColor(WHITE)
    c.setStrokeColor(GRAY_LINE)
    c.rect(margin, y - nota_h, content_w, nota_h, fill=1, stroke=1)
    c.setFillColor(colors.HexColor('#6B6B66'))
    c.setFont('Helvetica', 7)
    note_text = ("Il presente prospetto costituisce la base per l'emissione della fattura da parte del Procacciatore. "
                 "Il Procacciatore dichiara di essere in possesso di regolare Partita IVA e di assolvere "
                 "autonomamente agli obblighi previdenziali e fiscali di propria competenza.")
    # Wrap testo
    words = note_text.split()
    line = ''
    ry = y - 5*mm
    for word in words:
        test = (line + ' ' + word).strip()
        if c.stringWidth(test, 'Helvetica', 7) < content_w - 6*mm:
            line = test
        else:
            c.drawString(margin + 3*mm, ry, line)
            ry -= 4*mm
            line = word
    if line:
        c.drawString(margin + 3*mm, ry, line)
    y -= nota_h + 3*mm

    # ── FIRME ──
    fw = content_w / 2 - 5*mm
    # Firma azienda
    c.setFillColor(GRAY_ROW)
    c.rect(margin, y - 18*mm, fw, 18*mm, fill=1, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica', 7)
    c.drawString(margin + 2*mm, y - 4*mm, 'Firma e Timbro Azienda Mandante')
    c.setFont('Helvetica', 7.5)
    c.drawString(margin + 2*mm, y - 16*mm, 'Leone Consulting di Leonardo Angelucci')
    # Firma procacciatore
    c.setFillColor(GRAY_ROW)
    c.rect(margin + fw + 10*mm, y - 18*mm, fw, 18*mm, fill=1, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica', 7)
    c.drawString(margin + fw + 12*mm, y - 4*mm, 'Firma Procacciatore d\'Affari')
    y -= 20*mm

    # ── FOOTER ──
    c.setFillColor(BLUE)
    c.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica', 6.5)
    footer = f"Leone Consulting di Leonardo Angelucci  |  P.IVA 18231181001  |  Prospetto Compensi Procacciatore d'Affari – Regime PARTITA IVA  |  Generato il {datetime.now().strftime('%d/%m/%Y')}"
    c.drawCentredString(W/2, 3.5*mm, footer)

    c.save()
    return output_path


# ══════════════════════════════════════════════════════════════
# PROSPETTO COMPENSI — RITENUTA D'ACCONTO
# ══════════════════════════════════════════════════════════════

def genera_prospetto_ritenuta(dati, output_path):
    p = dati.get('procacciatore', {})
    v = dati.get('vendite', [])
    calc = dati.get('calcoli', {})
    mese = dati.get('mese', '')

    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Prospetto Compensi Ritenuta — {p.get('nome','')} — {mese}")

    y = H - 10*mm

    y = header_section(c, y,
        'PROSPETTO COMPENSI – PROCACCIATORE D\'AFFARI',
        'Regime: Persona Fisica senza P.IVA  |  Ritenuta d\'Acconto 23% (art. 25 DPR 600/73)'
    )
    y -= 3*mm

    margin = 13*mm
    content_w = W - 2 * margin

    # ── DATI AZIENDA ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI AZIENDA MANDANTE')
    rh = 10*mm
    cell_label(c, margin, y, content_w*0.45, rh, 'RAGIONE SOCIALE / DENOMINAZIONE', 'Leone Consulting di Leonardo Angelucci', value_size=8)
    cell_label(c, margin + content_w*0.45, y, content_w*0.25, rh, 'CODICE FISCALE / P.IVA', '18231181001')
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'SEDE LEGALE', 'Via Pia 42')
    y -= rh
    cell_label(c, margin, y, content_w*0.45, rh, 'SEDE OPERATIVA', 'Viale Guglielmo Oberdan 22')
    cell_label(c, margin + content_w*0.45, y, content_w*0.25, rh, 'CITTÀ / PROVINCIA / CAP', 'Velletri (RM) 00049')
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'TELEFONO', '379 126 4864')
    y -= rh
    cell_label(c, margin, y, content_w, 8*mm, 'EMAIL', 'amministrazione@leoneconsultingitalia.it')
    y -= 8*mm + 2*mm

    # ── DATI PROCACCIATORE ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI PROCACCIATORE D\'AFFARI')
    rh = 10*mm
    cell_label(c, margin, y, content_w*0.45, rh, 'COGNOME E NOME', p.get('nome', ''))
    cell_label(c, margin + content_w*0.45, y, content_w*0.30, rh, 'CODICE FISCALE', p.get('cf', ''))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'DATA DI NASCITA', p.get('nascita', ''))
    y -= rh
    cell_label(c, margin, y, content_w*0.40, rh, 'RESIDENZA / DOMICILIO', p.get('indirizzo', ''))
    cell_label(c, margin + content_w*0.40, y, content_w*0.35, rh, 'CITTÀ / CAP / PROVINCIA', p.get('citta', ''))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'TELEFONO / EMAIL', p.get('tel', ''), value_size=7)
    y -= rh
    # Riga documento identità (solo ritenuta)
    cell_label(c, margin, y, content_w*0.45, rh, 'DOCUMENTO D\'IDENTITÀ (TIPO E NUMERO)', p.get('doc_identita', ''))
    cell_label(c, margin + content_w*0.45, y, content_w*0.25, rh, 'RILASCIATO DA', p.get('doc_rilasciato', ''))
    cell_label(c, margin + content_w*0.70, y, content_w*0.30, rh, 'DATA RILASCIO / SCADENZA', p.get('doc_scadenza', ''))
    y -= rh + 2*mm

    # ── DATI CONTRATTO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI CONTRATTO / INCARICO E PERIODO DI COMPETENZA')
    rh = 9*mm
    cw4 = content_w / 4
    cell_label(c, margin, y, cw4, rh, 'N° CONTRATTO / INCARICO', dati.get('n_contratto', ''))
    cell_label(c, margin + cw4, y, cw4, rh, 'DATA INIZIO INCARICO', p.get('inizio', ''))
    cell_label(c, margin + cw4*2, y, cw4, rh, 'DATA FINE INCARICO', p.get('fine', ''))
    cell_label(c, margin + cw4*3, y, cw4, rh, 'ZONA / AREA GEOGRAFICA', dati.get('zona', 'Italia'))
    y -= rh
    cell_label(c, margin, y, content_w*0.50, rh, 'PRODOTTO / SERVIZIO OGGETTO DEL CONTRATTO', dati.get('prodotto', ''))
    cell_label(c, margin + content_w*0.50, y, content_w*0.25, rh, '% PROVVIGIONE BASE', str(calc.get('prov_pct', '')) + '%')
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, '% PROVVIGIONE SUPERPREMIO', '')
    y -= rh
    cell_label(c, margin, y, content_w*0.30, rh, 'MESE / PERIODO', mese)
    cell_label(c, margin + content_w*0.30, y, content_w*0.15, rh, 'ANNO', mese[:4] if mese else '')
    cell_label(c, margin + content_w*0.45, y, content_w*0.30, rh, 'DATA EMISSIONE PROSPETTO', datetime.now().strftime('%d/%m/%Y'))
    cell_label(c, margin + content_w*0.75, y, content_w*0.25, rh, 'N° PROSPETTO', dati.get('n_prospetto', ''))
    y -= rh + 2*mm

    # ── DETTAGLIO AFFARI ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DETTAGLIO AFFARI PROCACCIATI NEL PERIODO')
    th = 7*mm
    c.setFillColor(BLUE)
    c.rect(margin, y - th, content_w, th, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(margin + 2*mm, y - th + 2*mm, 'N°')
    c.drawString(margin + 10*mm, y - th + 2*mm, 'Cliente / Controparte')
    c.drawString(margin + 10*mm + content_w*0.38, y - th + 2*mm, 'Descrizione')
    c.drawRightString(W - margin - 32*mm, y - th + 2*mm, '% Provv.')
    c.drawRightString(W - margin - 2*mm, y - th + 2*mm, 'Provvigione Lorda (€)')
    y -= th

    for i in range(6):
        row_h = 8*mm
        bg = GRAY_ROW if i % 2 == 0 else WHITE
        c.setFillColor(bg)
        c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
        c.setStrokeColor(GRAY_LINE)
        c.setLineWidth(0.3)
        c.rect(margin, y - row_h, content_w, row_h, fill=0, stroke=1)
        c.setFillColor(colors.HexColor('#6B6B66'))
        c.setFont('Helvetica', 7.5)
        c.drawString(margin + 2*mm, y - row_h/2 - 2*mm, str(i+1))
        if i < len(v):
            vend = v[i]
            c.setFillColor(BLACK)
            c.setFont('Helvetica', 7.5)
            c.drawString(margin + 10*mm, y - row_h/2 - 2*mm, str(vend.get('cliente', ''))[:35])
            c.drawString(margin + 10*mm + content_w*0.38, y - row_h/2 - 2*mm, str(vend.get('prod', ''))[:40])
            c.drawRightString(W - margin - 32*mm, y - row_h/2 - 2*mm, str(vend.get('prov_pct', '')) + '%')
            c.drawRightString(W - margin - 2*mm, y - row_h/2 - 2*mm, fmtE(vend.get('prov', 0)))
        y -= row_h

    # Totale
    c.setFillColor(BLUE_LITE)
    c.rect(margin, y - 8*mm, content_w, 8*mm, fill=1, stroke=0)
    c.setStrokeColor(GRAY_LINE)
    c.rect(margin, y - 8*mm, content_w, 8*mm, fill=0, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica-Bold', 8.5)
    c.drawString(margin + 2*mm, y - 5.5*mm, 'TOTALE')
    c.drawRightString(W - margin - 2*mm, y - 5.5*mm, fmtE(calc.get('totale_lordo', 0)))
    y -= 8*mm + 2*mm

    # ── CALCOLO COMPENSO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'CALCOLO COMPENSO')
    th = 7*mm
    c.setFillColor(BLUE)
    c.rect(margin, y - th, content_w, th, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(margin + 2*mm, y - th + 2*mm, 'VOCE')
    c.drawString(margin + content_w*0.55, y - th + 2*mm, 'IMPORTO (€)')
    c.drawString(margin + content_w*0.72, y - th + 2*mm, 'NOTE / RIF. NORMATIVO')
    y -= th

    totale_lordo = float(calc.get('totale_lordo', 0))
    rimborsi = float(calc.get('rimborsi', 0))
    base_imponibile = totale_lordo * 0.50
    ritenuta = base_imponibile * 0.23  # = 11.5% del lordo
    bollo = 2.00 if totale_lordo > 77.47 else 0
    netto = totale_lordo + rimborsi - ritenuta - bollo

    voci_r = [
        ('Compenso Lordo (Provvigioni)', fmtE(totale_lordo), '', False),
        ('Eventuali Rimborsi Spese Documentati', '+' + fmtE(rimborsi) if rimborsi else '+ € —', 'Non concorrono alla base imponibile', False),
        ('Base Imponibile Ritenuta (50% del compenso)', fmtE(base_imponibile), 'Art. 25-bis DPR 600/73 – base = 50% provvigione', False),
        ('Ritenuta d\'Acconto IRPEF (23% su 50%)', '-' + fmtE(ritenuta), 'Effettivo 11,5% – F24 cod. 1040 entro il 16 del mese', False),
        ('Marca da Bollo (se compenso > € 77,47)', '-€ 2,00' if bollo else '—', 'Obbligatoria sulla ricevuta – art. 13 Tariffa DPR 642/72', False),
        ('NETTO A PAGARE AL PROCACCIATORE', fmtE(netto), '', True),
    ]

    for idx, (voce, importo, nota, is_total) in enumerate(voci_r):
        row_h = 9*mm
        if is_total:
            c.setFillColor(BLUE)
            c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 8.5)
        else:
            c.setFillColor(GRAY_ROW if idx % 2 == 0 else WHITE)
            c.rect(margin, y - row_h, content_w, row_h, fill=1, stroke=0)
            c.setFillColor(BLACK)
            c.setFont('Helvetica', 8)
        c.setStrokeColor(GRAY_LINE)
        c.rect(margin, y - row_h, content_w, row_h, fill=0, stroke=1)
        c.drawString(margin + 2*mm, y - 6*mm, voce)
        c.drawString(margin + content_w*0.55, y - 6*mm, importo)
        c.setFont('Helvetica', 7)
        c.setFillColor(colors.HexColor('#6B6B66') if not is_total else WHITE)
        if len(nota) > 45:
            nota = nota[:45] + '...'
        c.drawString(margin + content_w*0.72, y - 6*mm, nota)
        y -= row_h

    y -= 2*mm

    # ── DATI PAGAMENTO ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'DATI PAGAMENTO')
    rh = 9*mm
    cell_label(c, margin, y, content_w*0.25, rh, 'MODALITÀ DI PAGAMENTO', 'Bonifico Bancario')
    cell_label(c, margin + content_w*0.25, y, content_w*0.25, rh, 'DATA PREVISTA PAGAMENTO', dati.get('data_pagamento', ''))
    cell_label(c, margin + content_w*0.50, y, content_w*0.50, rh, 'IBAN / RIFERIMENTO BANCARIO', p.get('iban', ''))
    y -= rh + 2*mm

    # ── NOTE ──
    y = section_bar(c, margin, y, content_w, 6*mm, 'NOTE E DICHIARAZIONI')
    nota_h = 20*mm
    c.setFillColor(WHITE)
    c.setStrokeColor(GRAY_LINE)
    c.rect(margin, y - nota_h, content_w, nota_h, fill=1, stroke=1)
    c.setFillColor(colors.HexColor('#6B6B66'))
    c.setFont('Helvetica', 7)
    note_text = ("Il presente prospetto sostituisce la ricevuta di compenso. Leone Consulting (Sostituto d'Imposta) "
                 "provvede al versamento della ritenuta d'acconto del 23% tramite F24 (cod. 1040) entro il 16 del mese "
                 "successivo. Il Procacciatore utilizzerà la ritenuta come credito d'imposta in sede di dichiarazione "
                 "dei redditi (Mod. 730 / Mod. Redditi PF).")
    words = note_text.split()
    line = ''
    ry = y - 5*mm
    for word in words:
        test = (line + ' ' + word).strip()
        if c.stringWidth(test, 'Helvetica', 7) < content_w - 6*mm:
            line = test
        else:
            c.drawString(margin + 3*mm, ry, line)
            ry -= 4*mm
            line = word
    if line:
        c.drawString(margin + 3*mm, ry, line)
    y -= nota_h + 3*mm

    # ── FIRME ──
    fw = content_w / 2 - 5*mm
    c.setFillColor(GRAY_ROW)
    c.rect(margin, y - 18*mm, fw, 18*mm, fill=1, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica', 7)
    c.drawString(margin + 2*mm, y - 4*mm, 'Firma e Timbro Azienda Mandante')
    c.setFont('Helvetica', 7.5)
    c.drawString(margin + 2*mm, y - 16*mm, 'Leone Consulting di Leonardo Angelucci')
    c.setFillColor(GRAY_ROW)
    c.rect(margin + fw + 10*mm, y - 18*mm, fw, 18*mm, fill=1, stroke=1)
    c.setFillColor(BLACK)
    c.setFont('Helvetica', 7)
    c.drawString(margin + fw + 12*mm, y - 4*mm, 'Firma Procacciatore d\'Affari')

    # ── FOOTER ──
    c.setFillColor(BLUE)
    c.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica', 6.5)
    footer = f"Leone Consulting di Leonardo Angelucci  |  P.IVA 18231181001  |  Prospetto Compensi Procacciatore d'Affari – Regime RITENUTA D'ACCONTO  |  Generato il {datetime.now().strftime('%d/%m/%Y')}"
    c.drawCentredString(W/2, 3.5*mm, footer)

    c.save()
    return output_path


# ══════════════════════════════════════════════════════════════
# ENTRY POINT (chiamato da Node.js / Electron)
# ══════════════════════════════════════════════════════════════

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Uso: python3 genera_pdf.py <tipo> <dati_json> [output_path]")
        sys.exit(1)

    tipo = sys.argv[1]  # 'piva' o 'ritenuta'
    dati = json.loads(sys.argv[2])
    output = sys.argv[3] if len(sys.argv) > 3 else f'/tmp/prospetto_{tipo}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'

    if tipo == 'piva':
        path = genera_prospetto_piva(dati, output)
    elif tipo == 'ritenuta':
        path = genera_prospetto_ritenuta(dati, output)
    else:
        print(f"Tipo non riconosciuto: {tipo}")
        sys.exit(1)

    print(path)
