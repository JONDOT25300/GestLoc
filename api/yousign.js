export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  const KEY = process.env.YOUSIGN_API_KEY;
  const BASE = 'https://api-sandbox.yousign.app/v3';

  try {
    const { contractText, bailleur, locataire, adresse } = req.body;
    const pdf = makePDF(contractText || 'Contrat');

    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'contrat.pdf');
    fd.append('nature', 'signable_document');

    const r1 = await fetch(`${BASE}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: fd
    });
    const doc = await r1.json();
    if (!r1.ok) throw new Error(JSON.stringify(doc));

    const r2 = await fetch(`${BASE}/signature_requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bail - ' + adresse,
        delivery_mode: 'email',
        timezone: 'Europe/Paris',
        documents: [{ document_id: doc.id }],
        signers: [
          {
            info: { first_name: bailleur.prenom, last_name: bailleur.nom, email: bailleur.email, phone_number: bailleur.telephone, locale: 'fr' },
            signature_level: 'electronic_signature',
            signature_authentication_mode: 'otp_sms',
            fields: [{ document_id: doc.id, type: 'signature', page: 1, x: 50, y: 700, width: 180, height: 60 }]
          },
          {
            info: { first_name: locataire.prenom, last_name: locataire.nom, email: locataire.email, phone_number: locataire.telephone, locale: 'fr' },
            signature_level: 'electronic_signature',
            signature_authentication_mode: 'otp_sms',
            fields: [{ document_id: doc.id, type: 'signature', page: 1, x: 320, y: 700, width: 180, height: 60 }]
          }
        ]
      })
    });
    const sr = await r2.json();
    if (!r2.ok) throw new Error(JSON.stringify(sr));

    const r3 = await fetch(`${BASE}/signature_requests/${sr.id}/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` }
    });
    if (!r3.ok) { const e = await r3.json(); throw new Error(JSON.stringify(e)); }

    res.status(200).json({ success: true, signatureRequestId: sr.id });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function makePDF(text) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines = [];
  text.split('\n').forEach(l => {
    while (l.length > 80) { lines.push(l.slice(0, 80)); l = l.slice(80); }
    lines.push(l);
  });

  const pages = [];
  for (let i = 0; i < lines.length; i += 45) pages.push(lines.slice(i, i + 45));

  const objs = {};
  const add = (id, s) => { objs[id] = s; };

  add(1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds = pages.map((pg, pi) => {
    const sid = 10 + pi * 2;
    const pid = 11 + pi * 2;
    const stream = pg.map((l, i) => `BT /F1 10 Tf 40 ${800 - i * 16} Td (${esc(l)}) Tj ET`).join('\n');
    add(sid, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    add(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${sid} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
    return pid;
  });

  add(2, `<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`);
  add(3, '<< /Type /Catalog /Pages 2 0 R >>');

  let pdf = '%PDF-1.4\n';
  const off = {};
  Object.keys(objs).sort((a, b) => Number(a) - Number(b)).forEach(id => {
    off[id] = pdf.length;
    pdf += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  });

  const xref = pdf.length;
  const maxId = Math.max(...Object.keys(objs).map(Number));
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    pdf += off[i] !== undefined
      ? `${String(off[i]).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n';
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 3 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
