const otpStore = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  const BREVO_KEY = process.env.BREVO_API_KEY;
  const { action, email, code, nom, adresse, emailB, emailL, nomB, nomL, sealDate, pdfBase64 } = req.body;

  const sendEmail = async (to, toName, subject, html, attachment) => {
    const body = {
      sender: { name: 'GestLoc', email: 'sci.18thaugust@gmail.com' },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html
    };
    if (attachment) {
      body.attachment = [{ content: attachment, name: 'contrat-signe.pdf' }];
    }
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    return data;
  };

  try {
    if (action === 'send') {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 10 * 60 * 1000;
      otpStore.set(email, { otp, expires });

      const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <div style="background:#0f2545;padding:20px;border-radius:10px 10px 0 0;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">GestLoc</h1>
          <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">Signature electronique securisee</p>
        </div>
        <div style="background:#f8f9fc;padding:24px;border-radius:0 0 10px 10px;border:1px solid #e0e8f0">
          <p style="color:#0f2545;font-size:15px;margin:0 0 16px">Bonjour <strong>${nom || ''}</strong>,</p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 20px">Vous etes invite(e) a signer le contrat de location :<br><strong style="color:#0f2545">${adresse || 'Contrat de location'}</strong></p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 12px">Votre code de signature unique (valable 10 minutes) :</p>
          <div style="background:#0f2545;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px">
            <span style="color:#fff;font-size:36px;font-weight:bold;letter-spacing:10px">${otp}</span>
          </div>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 8px">Saisissez ce code dans l'application GestLoc pour confirmer votre identite et signer le contrat.</p>
          <p style="color:#aab0bc;font-size:11px;margin:0">Code personnel et confidentiel. Signature conforme loi n°2000-230 du 13 mars 2000.</p>
        </div>
      </div>`;

      await sendEmail(email, nom, `Code de signature — ${adresse || 'Contrat'}`, html);
      res.status(200).json({ success: true });

    } else if (action === 'verify') {
      const stored = otpStore.get(email);
      if (!stored) return res.status(200).json({ success: false, verified: false, message: 'Code expire ou inexistant' });
      if (Date.now() > stored.expires) { otpStore.delete(email); return res.status(200).json({ success: false, verified: false, message: 'Code expire' }); }
      if (stored.otp !== code) return res.status(200).json({ success: false, verified: false, message: 'Code incorrect' });
      otpStore.delete(email);
      res.status(200).json({ success: true, verified: true });

    } else if (action === 'sendContract') {
      const html = (destinataire) => `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <div style="background:#0f2545;padding:20px;border-radius:10px 10px 0 0;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">GestLoc</h1>
        </div>
        <div style="background:#f0faf4;padding:24px;border-radius:0 0 10px 10px;border:2px solid #22a05a">
          <p style="color:#0f2545;font-size:15px;margin:0 0 12px">Bonjour <strong>${destinataire}</strong>,</p>
          <p style="color:#22a05a;font-size:14px;font-weight:bold;margin:0 0 12px">✓ Votre contrat de location a été signé et scellé !</p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 8px">Bien : <strong style="color:#0f2545">${adresse || 'Contrat de location'}</strong></p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 16px">Scellé le : <strong style="color:#0f2545">${sealDate}</strong></p>
          <p style="color:#5a6a80;font-size:12px;margin:0">Le contrat signé est joint en pièce jointe PDF. Conservez-le précieusement.<br>
          Signature électronique conforme loi n°2000-230 du 13 mars 2000.</p>
        </div>
      </div>`;

      await sendEmail(emailB, nomB, `Contrat signé — ${adresse || 'Contrat de location'}`, html(nomB), pdfBase64);
      await sendEmail(emailL, nomL, `Contrat signé — ${adresse || 'Contrat de location'}`, html(nomL), pdfBase64);
      res.status(200).json({ success: true });

    } else {
      res.status(400).json({ error: 'Action invalide' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
