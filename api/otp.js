const otpStore = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode non autorisee' });

  const BREVO_KEY = process.env.BREVO_API_KEY;
  const { action, email, code, nom, adresse, emailB, emailL, nomB, nomL, sealDate, contractData } = req.body;

  const sendEmail = async (to, toName, subject, html, attachment) => {
    const body = {
      sender: { name: 'GestLoc', email: 'sci.18thaugust@gmail.com' },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html
    };
    if (attachment) body.attachment = [attachment];
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

      const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
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
          <p style="color:#aab0bc;font-size:11px;margin:0">Code personnel et confidentiel. Conforme loi n2000-230 du 13 mars 2000.</p>
        </div>
      </div>`;

      await sendEmail(email, nom, `Code de signature - ${adresse || 'Contrat'}`, html);
      res.status(200).json({ success: true });

    } else if (action === 'verify') {
      const stored = otpStore.get(email);
      if (!stored) return res.status(200).json({ success: false, verified: false, message: 'Code expire' });
      if (Date.now() > stored.expires) { otpStore.delete(email); return res.status(200).json({ success: false, verified: false, message: 'Code expire' }); }
      if (stored.otp !== code) return res.status(200).json({ success: false, verified: false, message: 'Code incorrect' });
      otpStore.delete(email);
      res.status(200).json({ success: true, verified: true });

    } else if (action === 'sendContract') {
      console.log('sendContract called');
      const { fileUrl } = req.body;
      const d = contractData;
      if (!d) throw new Error('contractData manquant');

      const loyer = parseFloat(d.fLoyer||0);
      const charges = parseFloat(d.fCharges||0);
      const total = loyer + charges;
      const fmtD = dt => { if(!dt) return '-'; try{ return new Date(dt).toLocaleDateString('fr-FR') } catch{ return dt } };
      const fmtE = v => v ? parseFloat(v).toLocaleString('fr-FR') + ' €' : '-';
      const isP = d.typeBien === 'parking';

      // Calcul première échéance
      let premiereEcheance = total;
      let labelEcheance = 'Mois complet';
      if(d.fDebut){
        const debut = new Date(d.fDebut);
        const jourDebut = debut.getDate();
        const joursTotal = new Date(debut.getFullYear(), debut.getMonth()+1, 0).getDate();
        if(jourDebut > 1){
          const joursR = joursTotal - jourDebut + 1;
          premiereEcheance = Math.round((total / joursTotal) * joursR * 100) / 100;
          labelEcheance = `Proratise ${joursR}j/${joursTotal}j`;
        }
      }

      const contractHtml = (destinataire) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f0f2f5">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.1)">

  <!-- EN-TÊTE -->
  <div style="background:#0f2545;padding:24px;text-align:center">
    <h1 style="color:#fff;font-size:24px;margin:0">GestLoc</h1>
    <p style="color:rgba(255,255,255,.6);font-size:12px;margin:6px 0 0">Contrat de location officiel</p>
  </div>

  <!-- BANDEAU SIGNÉ -->
  <div style="background:#22a05a;padding:14px;text-align:center">
    <p style="color:#fff;font-size:14px;font-weight:bold;margin:0">CONTRAT SIGNE ELECTRONIQUEMENT</p>
    <p style="color:rgba(255,255,255,.85);font-size:12px;margin:4px 0 0">Scelle le ${sealDate} - Conforme loi n2000-230 du 13 mars 2000</p>
  </div>

  <div style="padding:24px">
    <p style="color:#0f2545;font-size:15px;margin:0 0 20px">Bonjour <strong>${destinataire}</strong>,<br>
    Voici votre contrat de location signe. Conservez cet email precieusement.</p>

    <!-- PARTIES -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="width:50%;padding:12px;background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px 0 0 6px;vertical-align:top">
          <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Bailleur</div>
          <div style="font-size:14px;font-weight:bold;color:#0f2545">${d.bNom||'-'}</div>
          <div style="font-size:12px;color:#5a6a80;margin-top:4px">${d.bAdresse||''}</div>
          <div style="font-size:12px;color:#5a6a80">${d.bEmail||''}</div>
        </td>
        <td style="width:50%;padding:12px;background:#f8f9fc;border:1px solid #e0e8f0;border-left:none;border-radius:0 6px 6px 0;vertical-align:top">
          <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Locataire</div>
          <div style="font-size:14px;font-weight:bold;color:#0f2545">${(d.lPrenom||'')+' '+(d.lNom||'-')}</div>
          ${d.lNom2 ? `<div style="font-size:12px;color:#5a6a80">et ${d.lNom2}</div>` : ''}
          <div style="font-size:12px;color:#5a6a80">${d.lEmail||''}</div>
          ${d.lGarant||d.clGarant ? `<div style="font-size:11px;color:#8a9ab5;margin-top:4px">Garant: ${d.lGarant||d.clGarant}</div>` : ''}
        </td>
      </tr>
    </table>

    <!-- BIEN -->
    <div style="background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px;padding:14px;margin-bottom:16px">
      <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Bien loue</div>
      <div style="font-size:14px;font-weight:bold;color:#0f2545;margin-bottom:4px">${d.pAdresse||'-'}</div>
      ${!isP ? `<div style="font-size:12px;color:#5a6a80">${d.pType||''} ${d.fMeuble==='oui'?'meuble':'vide'} - ${d.pSurface||'-'} m2 - ${d.pPieces||'-'} pieces - DPE: ${d.pDpe||'-'}</div>` : `<div style="font-size:12px;color:#5a6a80">Place/Garage n ${d.pNumBox||'-'}</div>`}
    </div>

    <!-- FINANCES -->
    <div style="margin-bottom:16px">
      <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Conditions financieres</div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px;background:#f0f4fb;border-radius:6px 0 0 6px;text-align:center">
            <div style="font-size:10px;color:#6b7a8d">Loyer HC</div>
            <div style="font-size:16px;font-weight:bold;color:#0f2545">${fmtE(d.fLoyer)}</div>
          </td>
          <td style="padding:8px;background:#f0f4fb;text-align:center;border-left:2px solid #fff">
            <div style="font-size:10px;color:#6b7a8d">Charges</div>
            <div style="font-size:16px;font-weight:bold;color:#0f2545">${fmtE(d.fCharges)}</div>
          </td>
          <td style="padding:8px;background:#0f2545;border-radius:0 6px 6px 0;text-align:center">
            <div style="font-size:10px;color:rgba(255,255,255,.6)">Total mensuel</div>
            <div style="font-size:16px;font-weight:bold;color:#fff">${total.toLocaleString('fr-FR')} €</div>
          </td>
        </tr>
      </table>
      <div style="background:#e8f5ee;border-radius:6px;padding:10px 14px;margin-top:8px;display:flex;justify-content:space-between">
        <span style="color:#1a7a4a;font-size:13px">1ere echeance (${labelEcheance})</span>
        <strong style="color:#1a7a4a;font-size:15px">${premiereEcheance.toLocaleString('fr-FR')} €</strong>
      </div>
    </div>

    <!-- DURÉE -->
    <div style="background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px;padding:14px;margin-bottom:16px">
      <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Duree du bail</div>
      <table style="width:100%">
        <tr>
          <td style="font-size:12px;color:#5a6a80">Debut</td><td style="font-size:13px;font-weight:bold;color:#0f2545">${fmtD(d.fDebut)}</td>
          <td style="font-size:12px;color:#5a6a80">Duree</td><td style="font-size:13px;font-weight:bold;color:#0f2545">${d.fDuree||'-'}</td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#5a6a80;padding-top:6px">Depot garantie</td><td style="font-size:13px;font-weight:bold;color:#0f2545">${fmtE(d.clDepot||d.fDepot)}</td>
          <td style="font-size:12px;color:#5a6a80;padding-top:6px">Paiement</td><td style="font-size:13px;font-weight:bold;color:#0f2545">${d.fPeriodicite||'Mensuel'} - ${d.fEcheance||'a echoir'}</td>
        </tr>
      </table>
    </div>

    ${d.clTravaux ? `<div style="background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px;padding:14px;margin-bottom:16px"><div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Travaux</div><div style="font-size:13px;color:#0f2545">${d.clTravaux}</div></div>` : ''}

    ${d.clParticulieres ? `<div style="background:#f0faf4;border:1px solid #a8dfc0;border-radius:6px;padding:14px;margin-bottom:16px"><div style="font-size:10px;color:#22a05a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Conditions particulieres</div><div style="font-size:13px;color:#0f2545">${d.clParticulieres}</div></div>` : ''}

    ${Array.isArray(d.clAnnexes) && d.clAnnexes.length ? `<div style="background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px;padding:14px;margin-bottom:16px"><div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Annexes jointes</div>${d.clAnnexes.map(a=>`<div style="font-size:12px;color:#0f2545;padding:3px 0;border-bottom:1px solid #f0f0f0">&#9744; ${a}</div>`).join('')}</div>` : ''}

    <!-- CLAUSES LÉGALES -->
    <div style="background:#fff8ee;border-left:3px solid #c8a84b;padding:12px 14px;border-radius:0 6px 6px 0;margin-bottom:16px">
      <div style="font-size:11px;font-weight:bold;color:#8a6000;margin-bottom:6px">Clauses legales</div>
      <div style="font-size:11px;color:#5a4a00;line-height:1.6">
        Solidarite et indivisibilite entre locataires pour toutes les obligations.<br>
        Clause resolutoire: defaut loyer/charges - defaut depot garantie - defaut assurance - trouble voisinage.
      </div>
    </div>

    <!-- SIGNATURES -->
    <div style="background:#e8f5ee;border:2px solid #22a05a;border-radius:8px;padding:16px;margin-bottom:16px;text-align:center">
      <div style="font-size:14px;font-weight:bold;color:#22a05a;margin-bottom:8px">SIGNE ELECTRONIQUEMENT</div>
      <div style="font-size:12px;color:#2a7a4a;margin-bottom:4px">Scelle le ${sealDate}</div>
      <div style="font-size:11px;color:#5a8a6a">Fait a ${d.clLieu||'-'}, le ${fmtD(d.clDateSign)}</div>
      <div style="display:flex;justify-content:space-around;margin-top:12px;padding-top:12px;border-top:1px solid #c0e8d0">
        <div style="text-align:center"><div style="font-size:10px;color:#5a8a6a">Bailleur</div><div style="font-size:13px;font-weight:bold;color:#0f2545">${d.bNom||'-'}</div><div style="font-size:10px;color:#22a05a">&#10003; Valide par OTP</div></div>
        <div style="text-align:center"><div style="font-size:10px;color:#5a8a6a">Locataire</div><div style="font-size:13px;font-weight:bold;color:#0f2545">${(d.lPrenom||'')+' '+(d.lNom||'-')}</div><div style="font-size:10px;color:#22a05a">&#10003; Valide par OTP</div></div>
      </div>
    </div>

    <p style="color:#aab0bc;font-size:11px;text-align:center;margin:0">Document genere par GestLoc - Conforme loi n2000-230 du 13 mars 2000<br>Contrat de location - Loi du 6 juillet 1989 - Decret du 29 mai 2015</p>
  </div>
</div>
</body></html>`;

      const driveLink = fileUrl ? `<div style="text-align:center;margin:20px 0"><a href="${fileUrl}" style="background:#0f2545;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold">Télécharger le contrat PDF signé</a></div><p style="color:#5a6a80;font-size:12px;text-align:center">Lien permanent : <a href="${fileUrl}" style="color:#0f2545">${fileUrl}</a></p>` : '';
      
      const fullHtml = (dest) => contractHtml(dest).replace('</div>
</body>', driveLink + '</div>
</body>');
      
      await sendEmail(emailB, nomB, `Contrat signe - ${adresse||'Location'}`, fullHtml(nomB));
      await sendEmail(emailL, nomL, `Contrat signe - ${adresse||'Location'}`, fullHtml(nomL));
      console.log('Emails sent to', emailB, 'and', emailL);
      res.status(200).json({ success: true });

    } else {
      res.status(400).json({ error: 'Action invalide' });
    }
  } catch (e) {
    console.error('OTP error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
