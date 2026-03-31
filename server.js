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

// Inizializzazione Client (Senza Stripe)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
fal.config({ credentials: process.env.FAL_KEY });
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });

const SYSTEM_PROMPT = `Sei l'assistente di ideas2wear.eu. Rispondi SEMPRE in JSON. 
MODELLI: 'nano_banana_2' (illustrazioni), 'ideogram' (testo), 'recraft' (loghi). 
FORMATO: {"message": "...", "model": "...", "prompt": "...", "want_svg": false}`;

app.post('/api/chat', async (req, res) => {
  try {
    const { user_input, history_json, tentativi_fatti = 0 } = req.body;
    const LIMITE = 3;

    // Controllo limite 3 tentativi
    if (parseInt(tentativi_fatti) >= LIMITE) {
      return res.status(403).json({
        claude_message: "Hai raggiunto il limite di 3 creazioni gratuite. Scegli il tuo design o contattaci!",
        nuovo_conteggio: tentativi_fatti
      });
    }

    let history = [];
    try { history = JSON.parse(history_json || '[]'); } catch(e) {}
    history.push({ role: 'user', content: user_input });

    // Claude decide il modello (Haiku 4.5 come da report)
    const claudeRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history.filter(m => m.role !== 'system'),
    });

    const parsed = JSON.parse(claudeRes.content[0].text);
    let designUrl = '';

    // Generazione immagine su fal.ai
    if (parsed.model !== 'none') {
      const endpoint = parsed.model === 'nano_banana_2' ? 'fal-ai/nano-banana-2' : 
                       parsed.model === 'ideogram' ? 'fal-ai/ideogram/v3' : 'fal-ai/recraft/v4';
      
      const falRes = await fal.subscribe(endpoint, {
        input: { prompt: parsed.prompt, image_size: 'square_hd' }
      });
      designUrl = falRes.data.images[0].url;
    }

    // Upload su Dropbox per link permanente
    let finalUrl = designUrl;
    if (designUrl) {
      const imgRes = await axios.get(designUrl, { responseType: 'arraybuffer' });
      const path = `/disegni/design_${uuidv4()}.png`;
      await dbx.filesUpload({ path, contents: imgRes.data });
      const linkRes = await dbx.sharingCreateSharedLinkWithSettings({ path });
      finalUrl = linkRes.result.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');
    }

    res.json({
      claude_message: parsed.message,
      design_url: finalUrl,
      history_json: JSON.stringify([...history, { role: 'assistant', content: JSON.stringify(parsed) }]),
      nuovo_conteggio: parseInt(tentativi_fatti) + 1
    });

  } catch (error) {
    console.error("Errore:", error);
    res.status(500).json({ claude_message: "Errore tecnico, riprova." });
  }
});

// Endpoint ordine (Invio a Google Sheets tramite Make)
app.post('/api/create-order', async (req, res) => {
  try {
    await axios.post(process.env.MAKE_ORDER_WEBHOOK, {
      ...req.body,
      metodo_pagamento: "IN NEGOZIO",
      data: new Date().toISOString()
    });
    res.json({ success: true, message: "Ordine registrato!" });
  } catch (error) {
    res.status(500).json({ error: "Errore ordine" });
  }
});

app.listen(process.env.PORT || 3000);
