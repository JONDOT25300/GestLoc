export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const VERIFY_SID = process.env.TWILIO_VERIFY_SID;
  const BASE = `https://verify.twilio.com/v2/Services/${VERIFY_SID}`;
  const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

  const { action, phone, code } = req.body;

  try {
    if (action === 'send') {
      // Envoyer le code OTP par SMS
      const r = await fetch(`${BASE}/Verifications`, {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, Channel: 'sms' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      res.status(200).json({ success: true, status: data.status });

    } else if (action === 'verify') {
      // Vérifier le code saisi par l'utilisateur
      const r = await fetch(`${BASE}/VerificationCheck`, {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, Code: code })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      if (data.status === 'approved') {
        res.status(200).json({ success: true, verified: true });
      } else {
        res.status(200).json({ success: false, verified: false, message: 'Code incorrect ou expiré' });
      }
    } else {
      res.status(400).json({ error: 'Action invalide' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
