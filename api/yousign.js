export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY;
  const YOUSIGN_BASE_URL = 'https://api-sandbox.yousign.app/v3';

  try {
    const { pdfBase64, bailleur, locataire, adresse } = req.body;

    // 1. Upload du document
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'contrat.pdf');
    formData.append('nature', 'signable_document');

    const uploadRes = await fetch(`${YOUSIGN_BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}` },
      body: formData
    });
    const document = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`Upload échoué: ${JSON.stringify(document)}`);

    // 2. Créer la demande de signature
    const signatureRequest = {
      name: `Bail - ${adresse}`,
      delivery_mode: 'email',
      timezone: 'Europe/Paris',
      documents: [{ document_id: document.id }],
      signers: [
        {
          info: {
            first_name: bailleur.prenom,
            last_name: bailleur.nom,
            email: bailleur.email,
            phone_number: bailleur.telephone,
            locale: 'fr'
          },
          signature_level: 'electronic_signature',
          signature_authentication_mode: 'otp_sms',
          fields: [{
            document_id: document.id,
            type: 'signature',
            page: 5,
            x: 50, y: 650,
            width: 180, height: 60
          }]
        },
        {
          info: {
            first_name: locataire.prenom,
            last_name: locataire.nom,
            email: locataire.email,
            phone_number: locataire.telephone,
            locale: 'fr'
          },
          signature_level: 'electronic_signature',
          signature_authentication_mode: 'otp_sms',
          fields: [{
            document_id: document.id,
            type: 'signature',
            page: 5,
            x: 320, y: 650,
            width: 180, height: 60
          }]
        }
      ]
    };

    const srRes = await fetch(`${YOUSIGN_BASE_URL}/signature_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${YOUSIGN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(signatureRequest)
    });
    const sr = await srRes.json();
    if (!srRes.ok) throw new Error(`Création signature échouée: ${JSON.stringify(sr)}`);

    // 3. Activer la demande
    const activateRes = await fetch(`${YOUSIGN_BASE_URL}/signature_requests/${sr.id}/activate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${YOUSIGN_API_KEY}` }
    });
    const activated = await activateRes.json();
    if (!activateRes.ok) throw new Error(`Activation échouée: ${JSON.stringify(activated)}`);

    res.status(200).json({
      success: true,
      signatureRequestId: sr.id,
      message: 'Emails envoyés aux deux parties avec succès'
    });

  } catch (error) {
    console.error('Erreur YouSign:', error);
    res.status(500).json({ error: error.message });
  }
}
