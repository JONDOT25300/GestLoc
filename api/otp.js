import { google } from 'googleapis';

const otpStore = new Map();

// ──────────────────────────────────────────
// Helpers Google Auth
// ──────────────────────────────────────────
function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON manquant');
  
  let key;
  try {
    // Nettoyer les caractères de contrôle qui cassent JSON.parse
    // tout en préservant les \n légitimes dans la clé privée
    const cleaned = raw
      .replace(/\r\n/g, '\\n')  // CRLF Windows
      .replace(/\r/g, '\\n')    // CR seul
      .replace(/\n/g, '\\n');   // LF seul (sauf dans les strings JSON)
    key = JSON.parse(cleaned);
  } catch(e) {
    // Deuxième tentative : parser tel quel
    try {
      key = JSON.parse(raw);
    } catch(e2) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON invalide: ' + e2.message);
    }
  }

  // Restaurer les sauts de ligne dans la clé privée
  if (key.private_key) {
    key.private_key = key.private_key.replace(/\\n/g, '\n');
  }

  return new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive'
    ]
  );
}

// ──────────────────────────────────────────
// Mapping fd → marqueurs Google Doc
// ──────────────────────────────────────────
function buildReplacements(d, sealDate) {
  const fmtD = dt => { if (!dt) return '—'; try { return new Date(dt).toLocaleDateString('fr-FR') } catch { return dt } };
  const fmtE = v => v ? parseFloat(v).toLocaleString('fr-FR') + ' €' : '—';
  const loyer = parseFloat(d.fLoyer || 0);
  const charges = parseFloat(d.fCharges || 0);
  const isP = d.typeBien === 'parking';

  return {
    '{{type_bail}}':                isP ? 'PARKING / GARAGE — Bail de droit commun' : (d.fMeuble === 'oui' ? 'LOGEMENT MEUBLÉ' : 'LOGEMENT VU'),
    '{{bailleur_nom}}':             d.bNom || '—',
    '{{bailleur_adresse}}':         d.bAdresse || '—',
    '{{bailleur_email}}':           d.bEmail || '—',
    '{{bailleur_qualite}}':         d.bQualite || 'Personne physique',
    '{{bailleur_mandataire}}':      d.bMandataire || 'Sans objet',
    '{{locataire_nom}}':            d.lNom || '—',
    '{{locataire_prenom}}':         d.lPrenom || '',
    '{{locataire_email}}':          d.lEmail || '—',
    '{{locataire2}}':               d.lNom2 || 'Sans objet',
    '{{locataire2_email}}':         d.lEmail2 || 'Sans objet',
    '{{garant}}':                   d.lGarant || 'Sans objet',
    '{{adresse_bien}}':             d.pAdresse || '—',
    '{{identifiant_fiscal}}':       d.pFiscal || 'Non renseigné',
    '{{surface}}':                  d.pSurface || '—',
    '{{nb_pieces}}':                d.pPieces || '—',
    '{{type_logement}}':            d.pType || '—',
    '{{type_habitat}}':             d.pHabitat || '—',
    '{{regime_juridique}}':         d.pRegime || '—',
    '{{periode_construction}}':     d.pPeriode || '—',
    '{{classe_dpe}}':               d.pDpe || '—',
    '{{chauffage}}':                d.pChauffage || '—',
    '{{eau_chaude}}':               d.pEcs || '—',
    '{{autres_parties}}':           d.pExtras || 'Néant',
    '{{destination}}':              d.pUsage || 'Habitation',
    '{{equipements_tic}}':          d.pTic || 'Néant',
    '{{date_prise_effet}}':         fmtD(d.fDebut),
    '{{duree_contrat}}':            d.fDuree || '—',
    '{{meuble}}':                   d.fMeuble === 'oui' ? 'Oui — logement meublé' : 'Non — logement vide',
    '{{evenement_duree_reduite}}':  d.fEvenement || 'Sans objet',
    '{{loyer_hc}}':                 fmtE(d.fLoyer),
    '{{charges}}':                  fmtE(d.fCharges),
    '{{loyer_total}}':              (loyer + charges).toLocaleString('fr-FR') + ' €',
    '{{depot_garantie}}':           fmtE(d.fDepot),
    '{{periodicite}}':              d.fPeriodicite || 'Mensuel',
    '{{modalite_paiement}}':        d.fEcheance || 'À échoir',
    '{{date_paiement}}':            d.fDatePaiement || '—',
    '{{lieu_paiement}}':            d.fLieuPaiement || '—',
    '{{zone_tendue}}':              d.fTendue === 'oui' ? 'Oui — soumis au décret préfectoral' : 'Non',
    '{{revision_irl}}':             d.fIrl || 'Sans objet',
    '{{travaux}}':                  d.clTravaux || 'Néant',
    '{{depot_garantie_vi}}':        fmtE(d.clDepot || d.fDepot),
    '{{garant_vi}}':                d.clGarant || d.lGarant || 'Sans objet',
    '{{honoraires_bailleur}}':      fmtE(d.clHonBailleur),
    '{{honoraires_locataire}}':     fmtE(d.clHonLocataire),
    '{{conditions_particulieres}}': d.clParticulieres || 'Néant',
    '{{annexes}}':                  Array.isArray(d.clAnnexes) && d.clAnnexes.length
                                      ? d.clAnnexes.map(a => '☐ ' + a).join('\n')
                                      : 'Aucune annexe sélectionnée',
    '{{lieu_signature}}':           d.clLieu || '—',
    '{{date_signature}}':           fmtD(d.clDateSign),
    '{{seal_date}}':                sealDate,
  };
}

// ──────────────────────────────────────────
// Créer une copie du template + remplacer les marqueurs + exporter PDF
// ──────────────────────────────────────────
async function generateContractPdf(contractData, sealDate) {
  const TEMPLATE_ID = process.env.GOOGLE_DOC_TEMPLATE_ID;
  if (!TEMPLATE_ID) throw new Error('GOOGLE_DOC_TEMPLATE_ID manquant');

  const auth = getGoogleAuth();
  await auth.authorize();
  const docs  = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  const d = contractData;
  const nomLocataire = ((d.lPrenom || '') + '_' + (d.lNom || 'locataire')).replace(/[^a-zA-Z0-9]/g, '_');
  const dateFr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');

  // 1. Copier le template
  const copyRes = await drive.files.copy({
    fileId: TEMPLATE_ID,
    requestBody: { name: `Contrat_${nomLocataire}_${dateFr}` }
  });
  const copyId = copyRes.data.id;

  // 2. Remplacer tous les marqueurs {{...}}
  const replacements = buildReplacements(d, sealDate);
  const requests = Object.entries(replacements).map(([find, replace]) => ({
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace
    }
  }));

  await docs.documents.batchUpdate({
    documentId: copyId,
    requestBody: { requests }
  });

  // 3. Exporter en PDF (base64)
  const pdfRes = await drive.files.export(
    { fileId: copyId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );
  const pdfBase64 = Buffer.from(pdfRes.data).toString('base64');

  // 4. Supprimer la copie (on garde seulement le PDF)
  await drive.files.delete({ fileId: copyId });

  return pdfBase64;
}

// ──────────────────────────────────────────
// Handler principal (remplace l'ancien otp.js)
// ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) return res.status(500).json({ error: 'BREVO_API_KEY manquant' });

  const { action, email, code, nom, adresse, emailB, emailL, nomB, nomL, sealDate, contractData, annexeLinks } = req.body;

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
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Brevo non-JSON (${r.status}): ${text.slice(0, 300)}`); }
    if (!r.ok) throw new Error(`Brevo erreur: ${JSON.stringify(data)}`);
    return data;
  };

  try {
    // ── ACTION: send OTP ──
    if (action === 'send') {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(email, { otp, expires: Date.now() + 10 * 60 * 1000 });
      const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#0f2545;padding:20px;border-radius:10px 10px 0 0;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">GestLoc</h1>
          <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">Signature électronique sécurisée</p>
        </div>
        <div style="background:#f8f9fc;padding:24px;border-radius:0 0 10px 10px;border:1px solid #e0e8f0">
          <p style="color:#0f2545;font-size:15px;margin:0 0 16px">Bonjour <strong>${nom || ''}</strong>,</p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 20px">Vous êtes invité(e) à signer le contrat : <strong>${adresse || 'Contrat de location'}</strong></p>
          <p style="color:#5a6a80;font-size:13px;margin:0 0 12px">Votre code de signature (valable 10 minutes) :</p>
          <div style="background:#0f2545;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px">
            <span style="color:#fff;font-size:36px;font-weight:bold;letter-spacing:10px">${otp}</span>
          </div>
        </div>
      </div>`;
      await sendEmail(email, nom, `Code de signature - ${adresse || 'Contrat'}`, html);
      return res.status(200).json({ success: true });
    }

    // ── ACTION: verify OTP ──
    if (action === 'verify') {
      const stored = otpStore.get(email);
      if (!stored) return res.status(200).json({ success: false, verified: false, message: 'Code expiré' });
      if (Date.now() > stored.expires) { otpStore.delete(email); return res.status(200).json({ success: false, verified: false, message: 'Code expiré' }); }
      if (stored.otp !== code) return res.status(200).json({ success: false, verified: false, message: 'Code incorrect' });
      otpStore.delete(email);
      return res.status(200).json({ success: true, verified: true });
    }

    // ── ACTION: sendContract — NOUVEAU : Google Doc → PDF ──
    if (action === 'sendContract') {
      const d = contractData;
      if (!d) throw new Error('contractData manquant');

      console.log('📄 Génération du contrat depuis Google Doc template...');

      // Générer le PDF via Google Docs API
      const pdfBase64 = await generateContractPdf(d, sealDate);

      const nomLocataire = ((d.lPrenom || '') + ' ' + (d.lNom || 'Locataire')).trim();
      const nomFichier = `Contrat_${(d.lNom || 'locataire').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.pdf`;

      // Email HTML résumé (inchangé)
      const loyer = parseFloat(d.fLoyer || 0);
      const charges = parseFloat(d.fCharges || 0);
      const fmtD = dt => { try { return new Date(dt).toLocaleDateString('fr-FR') } catch { return dt || '—' } };
      const fmtE = v => v ? parseFloat(v).toLocaleString('fr-FR') + ' €' : '—';

      const emailHtml = (destinataire) => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f0f2f5;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#0f2545;padding:24px;text-align:center">
    <h1 style="color:#fff;font-size:24px;margin:0">GestLoc</h1>
    <p style="color:rgba(255,255,255,.6);font-size:12px;margin:6px 0 0">Contrat de location officiel</p>
  </div>
  <div style="background:#22a05a;padding:14px;text-align:center">
    <p style="color:#fff;font-size:14px;font-weight:bold;margin:0">CONTRAT SIGNÉ ÉLECTRONIQUEMENT</p>
    <p style="color:rgba(255,255,255,.85);font-size:12px;margin:4px 0 0">Scellé le ${sealDate}</p>
  </div>
  <div style="padding:24px">
    <p style="color:#0f2545;font-size:15px">Bonjour <strong>${destinataire}</strong>,<br>Voici votre contrat de location signé en pièce jointe.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="width:50%;padding:12px;background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px 0 0 6px;vertical-align:top">
          <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;margin-bottom:4px">Bailleur</div>
          <div style="font-size:14px;font-weight:bold;color:#0f2545">${d.bNom || '—'}</div>
        </td>
        <td style="width:50%;padding:12px;background:#f8f9fc;border:1px solid #e0e8f0;border-left:none;border-radius:0 6px 6px 0;vertical-align:top">
          <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;margin-bottom:4px">Locataire</div>
          <div style="font-size:14px;font-weight:bold;color:#0f2545">${nomLocataire}</div>
        </td>
      </tr>
    </table>
    <div style="background:#f8f9fc;border:1px solid #e0e8f0;border-radius:6px;padding:14px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:bold;color:#0f2545">${d.pAdresse || '—'}</div>
      <div style="font-size:12px;color:#5a6a80">Loyer : ${fmtE(d.fLoyer)} HC + ${fmtE(d.fCharges)} charges = <strong>${(loyer+charges).toLocaleString('fr-FR')} €/mois</strong></div>
      <div style="font-size:12px;color:#5a6a80">Début : ${fmtD(d.fDebut)} · Durée : ${d.fDuree || '—'}</div>
    </div>
    <div style="background:#e8f5ee;border:2px solid #22a05a;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:13px;font-weight:bold;color:#22a05a">SIGNÉ ÉLECTRONIQUEMENT — OTP Email</div>
      <div style="font-size:11px;color:#2a7a4a">Scellé le ${sealDate} · Conforme loi n°2000-230 du 13 mars 2000</div>
    </div>
    <p style="color:#aab0bc;font-size:11px;text-align:center;margin-top:16px">📎 Le contrat PDF complet est joint à cet email</p>
  </div>
</div>
</body></html>`;

      const attachment = { name: nomFichier, content: pdfBase64 };
      await sendEmail(emailB, nomB, `Contrat signé - ${d.pAdresse || 'Location'}`, emailHtml(nomB), attachment);
      await sendEmail(emailL, nomL, `Contrat signé - ${d.pAdresse || 'Location'}`, emailHtml(nomL), attachment);

      console.log(`✅ Contrat PDF envoyé à ${emailB} et ${emailL}`);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action invalide' });

  } catch (e) {
    console.error('OTP handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
