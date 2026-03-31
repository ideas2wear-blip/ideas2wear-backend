// ═══════════════════════════════════════════
// SETUP — IDEAS2WEAR CORE (Stripe rimosso)
// ═══════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const { Dropbox } = require('dropbox');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Inizializzazione Client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
fal.config({ credentials: process.env.FAL_KEY });
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });

// ═══════════════════════════════════════════
// CONFIGURAZIONE SYSTEM PROMPT (Sezione 5.3 report)
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente di ideas2wear.eu. Rispondi SEMPRE in JSON.
LOGICA MODELLI:
- 'nano_banana_2': arte, foto, stili complessi.
- 'ideogram': TESTO, slogan, citazioni.
- 'recraft': loghi vettoriali, icone.

PROMPT: Sempre in inglese, fondo bianco/trasparente, adatto alla stampa su t-shirt.
FORMATO: {"message": "...", "model": "...", "prompt": "...", "want_svg": false}`;

// ═══════════════════════════════════════════
// ENDPOINT CHAT — Generazione e Limite 3 Tentativi
// ═══════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { user_input, history_json, tentativi_fatti = 0 } = req.body;
    const LIMITE = 3;

    // 1. Controllo Limite
    if (parseInt(tentativi_fatti) >= LIMITE) {
      return res.status(403).json({
        claude_message: "Limite di 3 creazioni raggiunto! Scegli il tuo design preferito o procedi all'ordine.",
        nuovo_conteggio: tentativi_fatti
      });
    }

    let history = [];
    try { history = JSON.parse(history_json || '[]'); } catch(e) {}
    history.push({ role: 'user', content: user_input });

    // 2. Claude decide il modello
    const claudeRes = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history.filter(m => m.role !== 'system'),
    });

    const parsed = JSON.parse(claudeRes.content[0].text);
    
    // 3. Generazione Immagine su fal.ai
    let designUrl = '';
    if (parsed.model !== 'none') {
      const endpoint = {
        'nano_banana_2': 'fal-ai/nano-banana-2',
        'ideogram': 'fal-ai/ideogram/v3',
        'recraft': parsed.want_svg ? 'fal-ai/recraft/v4/text-to-vector' : 'fal-ai/recraft/v4'
      }[parsed.model];

      const falRes = await fal.subscribe(endpoint, {
        input: { prompt: parsed.prompt, image_size: 'square_hd' }
      });
      designUrl = falRes.data.images[0].url;
    }

    // 4. Upload su Dropbox (Link Permanente)
    let finalUrl = designUrl;
    if (designUrl) {
      const imgRes = await axios.get(designUrl, { responseType: 'arraybuffer' });
      const path = `/disegni/design_${uuidv4()}.png`;
      await dbx.filesUpload({ path, contents: imgRes.data });
      const linkRes = await dbx.sharingCreateSharedLinkWithSettings({ path });
      finalUrl = linkRes.result.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');
    }

    history.push({ role: 'assistant', content: JSON.stringify(parsed) });

    res.json({
      claude_message: parsed.message,
      design_url: finalUrl,
      history_json: JSON.stringify(history),
      nuovo_conteggio: parseInt(tentativi_fatti) + 1
    });

  } catch (error) {
    console.error("Errore Chat:", error);
    res.status(500).json({ error: "Errore tecnico" });
  }
});

// ═══════════════════════════════════════════
// ENDPOINT ORDINE — Google Sheets (via Make)
// ═══════════════════════════════════════════
app.post('/api/create-order', async (req, res) => {
  try {
    const orderData = req.body;
    
    // Invio al Webhook di Make che scriverà su Google Sheets
    if (process.env.MAKE_ORDER_WEBHOOK) {
      await axios.post(process.env.MAKE_ORDER_WEBHOOK, {
        ...orderData,
        metodo_pagamento: "IN NEGOZIO",
        data: new Date().toISOString()
      });
    }

    res.json({ success: true, message: "Ordine registrato!" });
  } catch (error) {
    res.status(500).json({ error: "Errore ordine" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ideas2wear attivo su porta ${PORT}`));
