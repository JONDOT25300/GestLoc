export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY;
  const BASE = 'https://api-sandbox.yousign.app/v3';

  try {
    const { contractText, bailleur, locataire, adresse } = req.body;
    const pdfBytes = buildPDF(contractText || 'Contrat de location');

    const formData = new FormData();
    formData.append('file', new Blob([pdfBytes], {type:'application/pdf'}), 'contrat.pdf');
    formData.append('nature', 'signable_document');

    const uploadRes = await fetch(`${BASE}/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}` },
      body: formData
    });
    const doc = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`Upload: ${JSON.stringify(doc)}`);

    const srRes = await fetch(`${BASE}/signature_requests`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Bail - ${adresse}`,
        delivery_mode: 'email',
        timezone: 'Europe/Paris',
        documents: [{ document_id: doc.id }],
        signers: [
          { info: { first_name: bailleur.prenom, last_name: bailleur.nom, email: bailleur.email, phone_number: bailleur.telephone, locale: 'fr' },
            signature_level: 'electronic_signature', signature_authentication_mode: 'otp_sms',
            fields: [{ document_id: doc.id, type: 'signature', page: 1, x: 50, y: 700, width: 180, height: 60 }] },
          {
