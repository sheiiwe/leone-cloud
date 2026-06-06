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


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Uso: python3 compila_pdf.py <piva|ritenuta> <json> [output]")
        sys.exit(1)
    tipo   = sys.argv[1]
    dati   = json.loads(sys.argv[2])
    output = sys.argv[3] if len(sys.argv) > 3 else f'/tmp/prospetto_{tipo}.pdf'
    con_timbro = len(sys.argv) > 4 and sys.argv[4] == 'timbro'
    if tipo == 'piva':       path = compila_piva(dati, output, con_timbro)
    elif tipo == 'ritenuta': path = compila_ritenuta(dati, output, con_timbro)
    else: sys.exit(1)
    print(path)
