// ═══════════════════════════════════════════
// SETUP — importa le librerie
// ═══════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
const { google } = require('googleapis');
const { Dropbox } = require('dropbox');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(express.json({ limit: '10mb' }));
 
// Inizializza i client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
fal.config({ credentials: process.env.FAL_KEY });
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// ═══════════════════════════════════════════
// SYSTEM PROMPT DI CLAUDE
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente di ideas2wear.eu, un servizio di magliette personalizzate.
Guidi l'utente nella creazione del design e nell'ordine.
 
REGOLA FONDAMENTALE: rispondi SEMPRE e SOLO con un oggetto JSON valido.
Nessun testo prima o dopo il JSON.
 
SCELTA DEL MODELLO AI:
- Usa "nano_banana_2" per: illustrazioni, cartoon, soggetti,
  animali, scene, paesaggi, stili artistici, fotorealismo
- Usa "ideogram" per: qualsiasi design che include TESTO, scritte,
  slogan, numeri, citazioni, tipografia, loghi con parole
- Usa "recraft" per: loghi SENZA testo, icone, simboli,
  design vettoriali, quando l'utente vuole file scalabile
- Usa "none" se non serve generare immagini
 
OTTIMIZZAZIONE PROMPT (SEMPRE in inglese, mai in italiano):
- Aggiungi sempre: white or transparent background
- Aggiungi sempre: suitable for t-shirt printing
- Specifica lo stile: cartoon style, vector illustration, graphic design
- Descrivi colori vivaci: bold colors, high contrast
- Per Ideogram con testo: includi il testo ESATTO tra virgolette
 
FORMATO RISPOSTA JSON OBBLIGATORIO:
{
  "message": "risposta in italiano per l'utente",
  "model": "nano_banana_2 | ideogram | recraft | none",
  "prompt": "prompt ottimizzato in inglese",
  "want_svg": false,
  "history": [array aggiornato della conversazione]
}
`;
// ═══════════════════════════════════════════
// ENDPOINT PRINCIPALE — chiamato da Landbot
// ═══════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { session_id, user_input, history_json, image_url } = req.body;
// Ricostruisce la history della conversazione
    let history = [];
    try { history = JSON.parse(history_json || '[]'); } catch(e) {}
 
    // Aggiunge il messaggio dell'utente alla history
    const userContent = [];
    userContent.push({ type: 'text', text: user_input });
    if (image_url) {
      userContent.push({ type: 'text',
        text: 'L\'utente ha caricato questa immagine: ' + image_url });
    }
    history.push({ role: 'user', content: userContent });
 
    // Chiama Claude
    const claudeRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });
 
    // Estrae il JSON dalla risposta di Claude
    let parsed;
    try {
      const text = claudeRes.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match[0]);
    } catch(e) {
      return res.json({
        claude_message: 'Scusa, riprova!',
        design_url: '', mockup_url: '', history_json: history_json
      });
    }
 
    // Aggiorna la history con la risposta di Claude
    history.push({ role: 'assistant', content: JSON.stringify(parsed) });
 
    let designUrl = '';
    let mockupUrl = '';
 
    // Genera l'immagine con il modello scelto da Claude
    if (parsed.model && parsed.model !== 'none' && parsed.prompt) {
      designUrl = await generateImage(parsed.model, parsed.prompt,
                                      parsed.want_svg, image_url);
    }
 
    // Crea il mockup se c'e' un'immagine
    if (designUrl) {
      mockupUrl = await createMockup(designUrl);
    }
 
    // Risponde a Landbot
    res.json({
      claude_message: parsed.message,
      design_url: designUrl,
      mockup_url: mockupUrl || designUrl,
      history_json: JSON.stringify(history)
    });
} catch (error) {
    console.error('Errore:', error.message);
    res.status(500).json({
      claude_message: 'Errore tecnico. Riprova tra poco!',
      design_url: '', mockup_url: ''
    });
  }
});
// ═══════════════════════════════════════════
// FUNZIONE GENERAZIONE IMMAGINE (fal.ai)
// ═══════════════════════════════════════════
async function generateImage(model, prompt, wantSvg, existingImageUrl) {
  try {
    let result;
 
    if (model === 'nano_banana_2') {
      // Genera con Nano Banana 2
      const input = {
        prompt: prompt,
        image_size: 'square_hd',  // 1024x1024
        num_images: 1
      };
      // Se c'e' un'immagine esistente da modificare, la passa
      if (existingImageUrl) {
        input.image_url = existingImageUrl;
      }
      result = await fal.subscribe('fal-ai/nano-banana-2', { input });
      return result.data.images[0].url;
    }
 
    if (model === 'ideogram') {
      // Genera con Ideogram 3 (ottimo per testo)
      result = await fal.subscribe('fal-ai/ideogram/v3', {
        input: {
          prompt: prompt,
          aspect_ratio: '1:1',
          style_type: 'design',
          rendering_speed: 'QUALITY'
        }
      });
      return result.data.images[0].url;
    }
 
    if (model === 'recraft') {
      // Genera con Recraft V4 (SVG o raster)
      const endpoint = wantSvg
        ? 'fal-ai/recraft/v4/text-to-vector'
        : 'fal-ai/recraft/v4';
      result = await fal.subscribe(endpoint, {
        input: {
          prompt: prompt,
          image_size: 'square_hd',
          style: wantSvg ? 'vector_illustration' : 'digital_illustration'
        }
      });
      return result.data.images[0].url;
    }
 
    return '';
  } catch(e) {
    console.error('Errore generazione:', e.message);
    return '';
  }
}
 
// ═══════════════════════════════════════════
// FUNZIONE MOCKUP (opzionale)
// ═══════════════════════════════════════════
async function createMockup(designUrl) {
  // Se non hai un servizio mockup, restituisce il design direttamente
  // Quando hai Dynamic Mockups, sostituisci questo codice
  return designUrl;
}
 
app.listen(process.env.PORT || 3000, () => {
  console.log('Server ideas2wear avviato!');
});
