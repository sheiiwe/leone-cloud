#!/usr/bin/env python3
"""
Compila documenti legali con dati procacciatore usando reportlab overlay su PDF template
"""
import sys, json, os
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
import io

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMPL_DIR = os.path.join(BASE_DIR, 'assets', 'templates')

W, H = A4  # 595.27 x 841.89

def overlay_testo(testo_campi, output_pages=1):
    """Crea overlay PDF con i testi nei campi specificati"""
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=A4)
    c.setFont("Helvetica", 9)
    
    for campo in testo_campi:
        pagina = campo.get('p', 1)
        if pagina != 1:
            continue
        x = campo['x']
        y = H - campo['y']  # Converti da top a bottom
        testo = str(campo.get('v', ''))
        c.drawString(x, y, testo)
    
    c.save()
    packet.seek(0)
    return packet

def compila_multi_page(tmpl_path, campi_per_pagina, out_path):
    """Compila un PDF multipagina con campi per pagina"""
    reader = PdfReader(tmpl_path)
    writer = PdfWriter()
    
    for i, page in enumerate(reader.pages):
        pagina_num = i + 1
        campi_pag = [c for c in campi_per_pagina if c.get('p', 1) == pagina_num]
        
        if campi_pag:
            packet = io.BytesIO()
            cv = canvas.Canvas(packet, pagesize=A4)
            cv.setFont("Helvetica", 9)
            for campo in campi_pag:
                x = campo['x']
                y = H - campo['y']
                testo = str(campo.get('v', ''))
                if testo:
                    cv.drawString(x, y, testo)
            cv.save()
            packet.seek(0)
            from pypdf import PdfReader as PR
            overlay_reader = PR(packet)
            page.merge_page(overlay_reader.pages[0])
        
        writer.add_page(page)
    
    with open(out_path, 'wb') as f:
        writer.write(f)
    return out_path

def campi_procacciatore(p, oggi):
    """Restituisce i campi comuni a tutti i documenti"""
    nome = p.get('nome', '')
    cf = p.get('cf', '') 
    indirizzo = p.get('indirizzo', '')
    citta = p.get('citta', '')
    email = p.get('email', '')
    tel = p.get('tel', '')
    return {
        'nome': nome,
        'cf': cf,
        'indirizzo': indirizzo,
        'citta': citta,
        'email': email,
        'tel': tel,
        'oggi': oggi,
    }

def compila_rinnovo(dati, out):
    import shutil
    shutil.copy(os.path.join(TMPL_DIR, 'RINNOVO_CONTRATTO.pdf'), out)
    return out

def compila_auth_commerciale(dati, out):
    import shutil
    shutil.copy(os.path.join(TMPL_DIR, 'AUTH_COMMERCIALE.pdf'), out)
    return out

def compila_auth_generica(dati, out):
    import shutil
    shutil.copy(os.path.join(TMPL_DIR, 'AUTH_GENERICA.pdf'), out)
    return out

def compila_auth_post(dati, out):
    import shutil
    shutil.copy(os.path.join(TMPL_DIR, 'AUTH_POST.pdf'), out)
    return out

def compila_recesso(dati, out):
    """Atto di Recesso - inviato blank, nessun campo compilato automaticamente"""
    import shutil
    tmpl = os.path.join(TMPL_DIR, 'RECESSO.pdf')
    shutil.copy(tmpl, out)
    return out

def compila_rete_commerciale(dati, out):
    """Richiesta Autorizzazione Rete Commerciale Autonoma - solo nome e CF in alto sinistra pag 1"""
    p = dati.get('procacciatore', {})
    cf_proc_override = dati.get('cf_proc_override', '')

    nome_proc = p.get('nome', '')
    cf_da_usare = cf_proc_override if cf_proc_override else p.get('cf', '')

    campi = [
        {'p':1,'x':72,'y':75,'v': nome_proc},
        {'p':1,'x':72,'y':89,'v': cf_da_usare},
    ]

    return compila_multi_page(
        os.path.join(TMPL_DIR, 'RETE_COMMERCIALE.pdf'),
        campi, out
    )


# Main
if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Uso: compila_documento.py <tipo> <dati_json> <output_path>")
        sys.exit(1)
    
    tipo = sys.argv[1]
    dati = json.loads(sys.argv[2])
    out = sys.argv[3]
    
    funzioni = {
        'rinnovo': compila_rinnovo,
        'auth_commerciale': compila_auth_commerciale,
        'auth_generica': compila_auth_generica,
        'auth_post': compila_auth_post,
        'recesso': compila_recesso,
        'rete_commerciale': compila_rete_commerciale,
    }
    
    if tipo not in funzioni:
        print(f"Tipo non valido: {tipo}", file=sys.stderr)
        sys.exit(1)
    
    path = funzioni[tipo](dati, out)
    print(path)
