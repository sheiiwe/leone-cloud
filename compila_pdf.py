"""
Compila i PDF originali Leone Consulting.
Usa fill_pdf_form_with_annotations.py della skill PDF.
"""
import sys, json, os, copy, subprocess, tempfile
from datetime import datetime

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
TMPL_DIR    = os.path.join(SCRIPT_DIR, 'assets', 'templates')
FIELDS_DIR  = os.path.join(SCRIPT_DIR, 'assets', 'fields')
FILL_SCRIPT = os.path.join(SCRIPT_DIR, 'fill_pdf_form_with_annotations.py')

TMPL_PIVA        = os.path.join(TMPL_DIR, 'CEDOLINO_PIVA.pdf')
TMPL_RIT         = os.path.join(TMPL_DIR, 'CEDOLINO_RITENUTA.pdf')
TMPL_PIVA_TIMBRO = os.path.join(TMPL_DIR, 'CEDOLINO_PIVA_TIMBRO.pdf')
TMPL_RIT_TIMBRO  = os.path.join(TMPL_DIR, 'CEDOLINO_RITENUTA_TIMBRO.pdf')
FIELDS_PIVA = os.path.join(FIELDS_DIR, 'fields_piva.json')
FIELDS_RIT  = os.path.join(FIELDS_DIR, 'fields_ritenuta.json')

def fe(n):
    try:
        return f"{float(n or 0):,.2f}".replace(',','X').replace('.',',').replace('X','.')
    except:
        return "0,00"

def fill_template(template_path, fields_path, replacements, output_path):
    """Carica il fields JSON, sostituisce i placeholder, genera il PDF."""
    with open(fields_path) as f:
        fields = json.load(f)

    for field in fields['form_fields']:
        t = field['entry_text']['text']
        for k, v in replacements.items():
            t = t.replace(k, str(v) if v else '')
        field['entry_text']['text'] = t

    # Salva fields temporaneo
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tf:
        json.dump(fields, tf)
        tmp_fields = tf.name

    try:
        r = subprocess.run(
            ['python3', FILL_SCRIPT, template_path, tmp_fields, output_path],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
    finally:
        os.unlink(tmp_fields)

    return output_path

def compila_piva(dati, output_path, con_timbro=False):
    p    = dati.get('procacciatore', {})
    v    = dati.get('vendite', [])
    calc = dati.get('calcoli', {})
    mese = dati.get('mese', '')

    tl    = float(calc.get('totale_lordo', 0))
    ri    = float(calc.get('rimborsi', 0))
    impon = tl + ri
    iva   = impon * 0.22
    rit   = impon * 0.115
    netto = impon + iva - rit

    tel_e = p.get('tel', '')
    if p.get('email'): tel_e += '  ' + p.get('email', '')

    repl = {
        '{{nome}}':       p.get('nome', ''),
        '{{cf}}':         p.get('cf', ''),
        '{{nascita}}':    p.get('nascita', ''),
        '{{indirizzo}}':  p.get('indirizzo', ''),
        '{{citta}}':      p.get('citta', ''),
        '{{tel_email}}':  tel_e[:35],
        '{{piva}}':       p.get('cf', ''),
        '{{ateco}}':      p.get('ateco', ''),
        '{{n_contratto}}':dati.get('n_contratto', ''),
        '{{data_inizio}}':p.get('inizio', ''),
        '{{data_fine}}':  p.get('fine', ''),
        '{{zona}}':       dati.get('zona', 'Italia'),
        '{{prodotto}}':   dati.get('prodotto', '')[:40],
        '{{prov_pct}}':   str(calc.get('prov_pct', '8')),
        '{{mese}}':       mese,
        '{{anno}}':       mese[:4] if mese else '',
        '{{data_em}}':    datetime.now().strftime('%d/%m/%Y'),
        '{{n_prosp}}':    dati.get('n_prospetto', ''),
        '{{totale}}':     fe(tl),
        '{{c_lordo}}':    fe(tl),
        '{{c_rimb}}':     fe(ri),
        '{{c_impon}}':    fe(impon),
        '{{c_iva}}':      fe(iva),
        '{{c_rit}}':      fe(rit),
        '{{c_netto}}':    fe(netto),
        '{{data_pag}}':   dati.get('data_pagamento', ''),
        '{{iban}}':       p.get('iban', ''),
    }
    # Righe affari
    for i in range(6):
        vn = v[i] if i < len(v) else {}
        repl[f'{{{{cl{i+1}}}}}']   = str(vn.get('cliente', ''))[:28] if vn else ''
        repl[f'{{{{desc{i+1}}}}}'] = str(vn.get('prod', ''))[:26] if vn else ''
        repl[f'{{{{pct{i+1}}}}}']  = str(vn.get('prov_pct', ''))+'%' if vn else ''
        repl[f'{{{{val{i+1}}}}}']  = fe(vn.get('prov', 0)) if vn else ''

    return fill_template(TMPL_PIVA, FIELDS_PIVA, repl, output_path)


def compila_ritenuta(dati, output_path, con_timbro=False):
    p    = dati.get('procacciatore', {})
    v    = dati.get('vendite', [])
    calc = dati.get('calcoli', {})
    mese = dati.get('mese', '')

    tl    = float(calc.get('totale_lordo', 0))
    ri    = float(calc.get('rimborsi', 0))
    base  = tl * 0.50
    rit   = base * 0.23
    bollo = 2.00 if tl > 77.47 else 0
    netto = tl + ri - rit - bollo

    repl = {
        '{{nome}}':          p.get('nome', ''),
        '{{cf}}':            p.get('cf', ''),
        '{{nascita}}':       p.get('nascita', ''),
        '{{indirizzo}}':     p.get('indirizzo', ''),
        '{{citta}}':         p.get('citta', ''),
        '{{tel_email}}':     p.get('tel', '')[:30],
        '{{doc_identita}}':  p.get('doc_identita', ''),
        '{{doc_rilasciato}}':p.get('doc_rilasciato', ''),
        '{{doc_scadenza}}':  p.get('doc_scadenza', ''),
        '{{n_contratto}}':   dati.get('n_contratto', ''),
        '{{data_inizio}}':   p.get('inizio', ''),
        '{{data_fine}}':     p.get('fine', ''),
        '{{zona}}':          dati.get('zona', 'Italia'),
        '{{prodotto}}':      dati.get('prodotto', '')[:40],
        '{{prov_pct}}':      str(calc.get('prov_pct', '8')),
        '{{mese}}':          mese,
        '{{anno}}':          mese[:4] if mese else '',
        '{{data_em}}':       datetime.now().strftime('%d/%m/%Y'),
        '{{n_prosp}}':       dati.get('n_prospetto', ''),
        '{{totale}}':        fe(tl),
        '{{c_lordo}}':       fe(tl),
        '{{c_rimb}}':        fe(ri),
        '{{c_base}}':        fe(base),
        '{{c_rit}}':         fe(rit),
        '{{c_bollo}}':       '2,00' if bollo else '0,00',
        '{{c_netto}}':       fe(netto),
        '{{data_pag}}':      dati.get('data_pagamento', ''),
        '{{iban}}':          p.get('iban', ''),
    }
    for i in range(6):
        vn = v[i] if i < len(v) else {}
        repl[f'{{{{cl{i+1}}}}}']   = str(vn.get('cliente', ''))[:28] if vn else ''
        repl[f'{{{{desc{i+1}}}}}'] = str(vn.get('prod', ''))[:26] if vn else ''
        repl[f'{{{{pct{i+1}}}}}']  = str(vn.get('prov_pct', ''))+'%' if vn else ''
        repl[f'{{{{val{i+1}}}}}']  = fe(vn.get('prov', 0)) if vn else ''

    return fill_template(TMPL_RIT, FIELDS_RIT, repl, output_path)




# ══════════════════════════════════════════════════════════════
#  TESSERINO DI RICONOSCIMENTO  (fronte+retro PDF, oppure immagine)
# ══════════════════════════════════════════════════════════════
import os, base64 as _b64, tempfile as _tmp
from reportlab.pdfgen import canvas as _cv_mod
canvas = _cv_mod
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

_LOGO_TESS_B64 = "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"

def _file_da_b64(b64, suffisso=".png"):
    """Scrive un\'immagine base64 (anche data:image/...;base64,) in un file temporaneo."""
    if not b64: return None
    try:
        s = str(b64)
        if "," in s and s.strip().lower().startswith("data:"):
            s = s.split(",", 1)[1]
        raw = _b64.b64decode(s)
        f = _tmp.NamedTemporaryFile(delete=False, suffix=suffisso)
        f.write(raw); f.close()
        return f.name
    except Exception:
        return None

W, H = 85.6*mm, 54*mm
INK   = (0.078, 0.063, 0.059)
ROSSO = (0.773, 0.118, 0.149)
GRIGIO= (0.541, 0.510, 0.478)
LINEA = (0.906, 0.890, 0.867)
VERIFICA = "verifica.leoneconsultingitalia.it"

def _txt(c, x, y, s, font="Helvetica", size=8, col=(0,0,0)):
    if s is None or str(s).strip()=="" : return
    c.setFillColorRGB(*col); c.setFont(font, size); c.drawString(x, y, str(s))

def _data(d):
    if not d: return ""
    try:
        a,m,g = str(d)[:10].split("-")
        return f"{g}/{m}/{a}"
    except Exception:
        return str(d)

def fronte(c, t, logo=None, foto=None):
    # fascia superiore
    c.setFillColorRGB(*INK); c.rect(0, H-13*mm, W, 13*mm, stroke=0, fill=1)
    if logo and os.path.exists(logo):
        try: c.drawImage(ImageReader(logo), 4*mm, H-11.4*mm, width=9.6*mm, height=9.6*mm, mask='auto')
        except Exception: pass
    _txt(c, 16*mm, H-6.6*mm, "LEONE CONSULTING", "Helvetica-Bold", 9.4, (1,1,1))
    _txt(c, 16*mm, H-10.2*mm, "di Leonardo Angelucci  ·  P.IVA 18231181001", "Helvetica", 5.4, (0.75,0.73,0.71))
    c.setFillColorRGB(*ROSSO); c.rect(0, H-13.9*mm, W, 0.9*mm, stroke=0, fill=1)

    # foto
    fx, fy, fw, fh = 4*mm, H-38*mm, 19*mm, 22.5*mm
    c.setFillColorRGB(0.96,0.95,0.94); c.roundRect(fx, fy, fw, fh, 1.6*mm, stroke=0, fill=1)
    if foto and os.path.exists(foto):
        try:
            c.saveState(); pth=c.beginPath()
            pth.roundRect(fx, fy, fw, fh, 1.6*mm); c.clipPath(pth, stroke=0)
            c.drawImage(ImageReader(foto), fx, fy, width=fw, height=fh, preserveAspectRatio=True, anchor='c', mask='auto')
            c.restoreState()
        except Exception: pass
    else:
        _txt(c, fx+6.4*mm, fy+10.4*mm, "FOTO", "Helvetica-Bold", 6, GRIGIO)

    # dati
    x = 26*mm
    _txt(c, x, H-19.6*mm, (t.get("ruolo") or "").upper()[:34], "Helvetica-Bold", 5.6, ROSSO)
    nome = (t.get("nome") or "")
    c.setFillColorRGB(*INK)
    size = 11 if len(nome) <= 22 else (9.5 if len(nome) <= 28 else 8.4)
    c.setFont("Helvetica-Bold", size); c.drawString(x, H-24.6*mm, nome[:38])

    y = H-29.4*mm
    def campo(et, val):
        nonlocal y
        if not val: return
        _txt(c, x, y, et, "Helvetica", 4.9, GRIGIO)
        _txt(c, x+16*mm, y, val, "Helvetica-Bold", 6.4, INK)
        y -= 4.3*mm
    campo("NATO IL", _data(t.get("nascita")))
    campo("A", (t.get("luogo_nascita") or "")[:26])
    campo("N. TESSERA", t.get("codice"))
    campo("VALIDO FINO AL", _data(t.get("scade_il")))

    # QR
    url = f"https://{VERIFICA}/{t.get('codice','')}"
    q = QrCodeWidget(url, barLevel='M'); b = q.getBounds()
    lato = 17.5*mm
    d = Drawing(lato, lato, transform=[lato/(b[2]-b[0]),0,0,lato/(b[3]-b[1]),0,0])
    d.add(q)
    renderPDF.draw(d, c, W-21.5*mm, 4.2*mm)
    _txt(c, W-21.5*mm, 2.4*mm, "Verifica online", "Helvetica", 4.4, GRIGIO)

def retro(c, t):
    c.setFillColorRGB(*INK); c.rect(0, 0, W, H, stroke=0, fill=1)
    _txt(c, 5*mm, H-8*mm, "TESSERINO DI RICONOSCIMENTO", "Helvetica-Bold", 7.4, (1,1,1))
    c.setFillColorRGB(*ROSSO); c.rect(5*mm, H-10.4*mm, 22*mm, 0.7*mm, stroke=0, fill=1)

    righe = [
        "Il titolare e' autorizzato a operare",
        "per conto di Leone Consulting",
        "di Leonardo Angelucci.",
        "",
        "Per verificare l'autenticita' inquadra",
        "il QR sul fronte oppure visita:",
        VERIFICA,
        "",
        "Non autorizza alla riscossione di denaro",
        "contante ne' alla firma di contratti.",
        "",
        "Se smarrito riconsegnare a:",
        "Viale G. Oberdan 22, Velletri (RM)",
        "tel. 379 126 4864",
    ]
    y = H-14.2*mm
    for r in righe:
        col = (1,1,1) if r == VERIFICA else (0.80,0.78,0.76)
        fnt = "Helvetica-Bold" if r == VERIFICA else "Helvetica"
        _txt(c, 5*mm, y, r, fnt, 5.2, col)
        y -= 2.72*mm

    # numero tessera in alto a destra, per non sovrapporsi al testo
    c.setFillColorRGB(0.62, 0.60, 0.58); c.setFont("Helvetica-Bold", 5.6)
    c.drawRightString(W-5*mm, H-8*mm, f"N. {t.get('codice','')}")

def genera(dati, out_pdf, logo=None, foto=None):
    c = canvas.Canvas(out_pdf, pagesize=(W, H))
    fronte(c, dati, logo, foto); c.showPage()
    retro(c, dati); c.showPage()
    c.save()
    return out_pdf


# ══════════════════════════════════════════════════════════════
#  VERSIONE IMMAGINE (per il telefono)  — solo Pillow, gia' presente
# ══════════════════════════════════════════════════════════════
def _font(bold=False, size=20):
    from PIL import ImageFont
    cand = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for f in cand:
        try:
            if os.path.exists(f): return ImageFont.truetype(f, size)
        except Exception: pass
    try: return ImageFont.load_default(size)
    except Exception: return ImageFont.load_default()

def _qr_img(testo, lato_px):
    from PIL import Image
    q = QrCodeWidget(testo, barLevel='M'); q.qr.make()
    n = q.qr.getModuleCount()
    quiet = 2
    tot = n + quiet*2
    passo = max(1, lato_px // tot)
    im = Image.new("RGB", (tot*passo, tot*passo), "white")
    px = im.load()
    for r in range(n):
        for cc in range(n):
            if q.qr.isDark(r, cc):
                for a in range(passo):
                    for b in range(passo):
                        px[(cc+quiet)*passo+a, (r+quiet)*passo+b] = (0,0,0)
    return im.resize((lato_px, lato_px), Image.NEAREST)

def genera_png(dati, out_png, logo=None, foto=None, scala=12):
    """Tesserino fronte come immagine, comodo da salvare sul telefono."""
    from PIL import Image, ImageDraw
    Wp, Hp = int(85.6*scala), int(54*scala)
    im = Image.new("RGB", (Wp, Hp), "white")
    d = ImageDraw.Draw(im)
    ink=(20,16,15); rosso=(197,30,38); grigio=(138,130,122)

    # fascia
    d.rectangle([0,0,Wp,int(13*scala)], fill=ink)
    d.rectangle([0,int(13*scala),Wp,int(13.9*scala)], fill=rosso)
    if logo and os.path.exists(logo):
        try:
            lg = Image.open(logo).convert("RGBA")
            L = int(9.6*scala); lg = lg.resize((L,L), Image.LANCZOS)
            im.paste(lg, (int(4*scala), int(1.7*scala)), lg)
        except Exception: pass
    d.text((int(16*scala), int(3.4*scala)), "LEONE CONSULTING", font=_font(True, int(3.4*scala)), fill=(255,255,255))
    d.text((int(16*scala), int(7.6*scala)), "di Leonardo Angelucci  ·  P.IVA 18231181001", font=_font(False, int(2.0*scala)), fill=(190,185,180))

    # foto
    fx, fy = int(4*scala), int(16*scala)
    fw, fh = int(19*scala), int(22.5*scala)
    d.rounded_rectangle([fx,fy,fx+fw,fy+fh], radius=int(1.6*scala), fill=(245,243,241))
    if foto and os.path.exists(foto):
        try:
            ph = Image.open(foto).convert("RGB")
            r = max(fw/ph.width, fh/ph.height)
            ph = ph.resize((int(ph.width*r), int(ph.height*r)), Image.LANCZOS)
            ph = ph.crop(((ph.width-fw)//2, (ph.height-fh)//2, (ph.width-fw)//2+fw, (ph.height-fh)//2+fh))
            im.paste(ph, (fx, fy))
        except Exception: pass
    else:
        d.text((fx+int(6.4*scala), fy+int(10*scala)), "FOTO", font=_font(True,int(2.2*scala)), fill=grigio)

    # dati
    x = int(26*scala)
    d.text((x, int(16.4*scala)), (dati.get("ruolo") or "").upper()[:34], font=_font(True,int(2.1*scala)), fill=rosso)
    nome = dati.get("nome") or ""
    sz = 4.0 if len(nome)<=22 else (3.4 if len(nome)<=28 else 3.0)
    d.text((x, int(19.6*scala)), nome[:38], font=_font(True,int(sz*scala)), fill=ink)

    y = int(26.4*scala)
    def campo(et, val):
        nonlocal y
        if not val: return
        d.text((x, y), et, font=_font(False,int(1.85*scala)), fill=grigio)
        d.text((x+int(16*scala), y-int(0.3*scala)), str(val), font=_font(True,int(2.4*scala)), fill=ink)
        y += int(4.3*scala)
    campo("NATO IL", _data(dati.get("nascita")))
    campo("A", (dati.get("luogo_nascita") or "")[:26])
    campo("N. TESSERA", dati.get("codice"))
    campo("VALIDO FINO AL", _data(dati.get("scade_il")))

    # QR
    lato = int(17.5*scala)
    qr = _qr_img(f"https://{VERIFICA}/{dati.get('codice','')}", lato)
    im.paste(qr, (Wp-int(21.5*scala), Hp-int(21.7*scala)))
    d.text((Wp-int(21.5*scala), Hp-int(3.6*scala)), "Verifica online", font=_font(False,int(1.7*scala)), fill=grigio)

    im.save(out_png, "PNG", optimize=True)
    return out_png



def compila_tesserino(dati, output):
    logo = _file_da_b64(_LOGO_TESS_B64)
    foto = _file_da_b64(dati.get("foto") or dati.get("foto_url"), ".jpg")
    if str(output).lower().endswith(".png"):
        return genera_png(dati, output, logo, foto)
    return genera(dati, output, logo, foto)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Uso: python3 compila_pdf.py <piva|ritenuta> <json> [output]")
        sys.exit(1)
    tipo   = sys.argv[1]
    dati   = json.loads(sys.argv[2])
    output = sys.argv[3] if len(sys.argv) > 3 else f'/tmp/prospetto_{tipo}.pdf'
    con_timbro = len(sys.argv) > 4 and sys.argv[4] == 'timbro'
    if tipo == 'tesserino':
        if not output.lower().endswith('.png'): output = output[:-4] + '.pdf' if output.lower().endswith('.pdf') else output + '.pdf'
        path = compila_tesserino(dati, output)
    elif tipo == 'tesserino_png':
        if not output.lower().endswith('.png'): output = (output[:-4] if output.lower().endswith('.pdf') else output) + '.png'
        path = compila_tesserino(dati, output)
    elif tipo == 'piva':       path = compila_piva(dati, output, con_timbro)
    elif tipo == 'ritenuta': path = compila_ritenuta(dati, output, con_timbro)
    else: sys.exit(1)
    print(path)
