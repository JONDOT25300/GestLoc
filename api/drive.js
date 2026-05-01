export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  
  const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

  try {
    const { pdfBase64, fileName } = req.body;
    if (!pdfBase64) throw new Error('pdfBase64 manquant');

    // 1. Obtenir un token Google OAuth2
    const token = await getGoogleToken(CLIENT_EMAIL, PRIVATE_KEY);

    // 2. Upload du PDF sur Google Drive
    const pdfBytes = Buffer.from(pdfBase64, 'base64');
    const boundary = 'boundary_gestloc_' + Date.now();
    const metadata = JSON.stringify({
      name: fileName || 'contrat-signe.pdf',
      parents: [FOLDER_ID],
      mimeType: 'application/pdf'
    });

    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      '',
      pdfBase64,
      `--${boundary}--`
    ].join('\r\n');

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body)
      },
      body
    });

    const fileData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`Upload Drive: ${JSON.stringify(fileData)}`);

    // 3. Rendre le fichier accessible en lecture seule (anyone with link)
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    const fileUrl = `https://drive.google.com/file/d/${fileData.id}/view`;
    console.log('PDF uploaded to Drive:', fileUrl);

    res.status(200).json({ success: true, fileUrl, fileId: fileData.id });

  } catch (e) {
    console.error('Drive error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

async function getGoogleToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const signingInput = `${header}.${payload}`;

  // Import private key
  const keyData = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(keyData, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(signingInput)
  );

  const jwt = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}
