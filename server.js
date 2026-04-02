// ═══════════════════════════════════════════════════
// PARTE 1 — Setup
// ═══════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const https = require('https');   // built-in Node.js, nessun npm
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ═══════════════════════════════════════════════════
// PARTE 2 — Funzione HTTP generica per chiamare fal.ai
// Nessun pacchetto npm necessario — usa Node built-in
// ═══════════════════════════════════════════════════
function falPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'fal.run',
      path: '/' + endpoint,
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + process.env.FAL_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          console.log('FAL risposta status:', res.statusCode);
          if (res.statusCode !== 200) {
            console.error('FAL errore:', raw);
            reject(new Error('fal.ai status ' + res.statusCode + ': ' + raw));
          } else {
            resolve(parsed);
          }
        } catch(e) {
          reject(new Error('fal.ai risposta non JSON: ' + raw));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(55000, () => {
      req.destroy();
      reject(new Error('fal.ai timeout 55s'));
    });
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// PARTE 3 — System Prompt completo per Claude
// ═══════════════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente di ideas2wear.eu, magliette personalizzate con AI.
Rispondi SEMPRE e SOLO con un oggetto JSON valido. Zero testo fuori dal JSON.

SCELTA MODELLO:
- "nano_banana_2": design senza testo, illustrazioni, cartoon, soggetti, stili artistici, trasformazione foto
- "nano_banana_2_edit": quando l'utente vuole modificare il design precedente o ha caricato una foto
- "ideogram": quando il design include PAROLE, scritte, slogan, nomi, numeri, citazioni
- "recraft_svg": loghi senza testo, icone, simboli, elementi vettoriali

COSTRUZIONE PROMPT (sempre in inglese):
- Aggiungi sempre: white or transparent background, suitable for t-shirt printing, high contrast
- Per cartoon/illustrazione aggiungi: bold outlines, flat colors, graphic design style
- Per testo (ideogram) includi le parole ESATTE tra virgolette nel prompt
- Per loghi (recraft) aggiungi: minimalist, vector illustration, professional

FORMATO RISPOSTA JSON OBBLIGATORIO:
{
  "message": "risposta in italiano per l'utente",
  "model": "nano_banana_2",
  "prompt": "detailed prompt in english for image generation"
}
`;

// ═══════════════════════════════════════════════════
// PARTE 4 — Endpoint principale chiamato da Landbot
// ═══════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { user_input, history_json, image_url } = req.body;

    console.log('=== NUOVA RICHIESTA ===');
    console.log('user_input:', user_input);
    console.log('image_url:', image_url || '(nessuna)');

    // Ricostruisce la history
    let history = [];
    try { history = JSON.parse(history_json || '[]'); } catch { history = []; }

    // Costruisce il messaggio utente
    let userText = user_input || '';
    if (image_url && image_url.trim() !== '') {
      userText += ' [Immagine caricata dall\'utente: ' + image_url + ']';
    }
    history.push({ role: 'user', content: userText });

    // Chiama Claude
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const rawText = claudeResponse.content[0].text;
    console.log('Claude raw:', rawText);

    // Estrae il JSON
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
      console.log('Claude parsed - model:', parsed.model);
      console.log('Claude parsed - prompt:', parsed.prompt);
    } catch(e) {
      console.error('Errore parsing JSON Claude:', e.message);
      return res.json({
        claude_message: 'Scusa, ho avuto un problema. Riprova!',
        design_url: '',
        history_json: JSON.stringify(history)
      });
    }

    // Genera l'immagine
    let designUrl = '';
    if (parsed.model && parsed.prompt) {
      designUrl = await generateImage(parsed.model, parsed.prompt, image_url);
    }

    console.log('design_url risultante:', designUrl || '(vuoto)');

    // Aggiorna history
    history.push({
      role: 'assistant',
      content: JSON.stringify({ message: parsed.message, model: parsed.model, design_url: designUrl })
    });

    res.json({
      claude_message: parsed.message,
      design_url: designUrl,
      history_json: JSON.stringify(history)
    });

  } catch (error) {
    console.error('ERRORE GENERALE:', error.message);
    res.status(500).json({
      claude_message: 'Errore tecnico. Riprova!',
      design_url: '',
      history_json: req.body.history_json || '[]'
    });
  }
});

// ═══════════════════════════════════════════════════
// PARTE 5 — Funzione generazione immagine via HTTP
// ═══════════════════════════════════════════════════
async function generateImage(model, prompt, existingImageUrl) {
  try {
    console.log('Chiamo fal.ai con modello:', model);

    let result;

    if (model === 'nano_banana_2') {
      result = await falPost('fal-ai/nano-banana-2', {
        prompt: prompt,
        image_size: 'square_hd',
        num_images: 1,
        output_format: 'png'
      });
      console.log('NB2 risposta:', JSON.stringify(result).slice(0, 300));
      return result?.images?.[0]?.url || '';
    }

    if (model === 'nano_banana_2_edit') {
      const image_urls = [];
      if (existingImageUrl && existingImageUrl.trim() !== '') {
        image_urls.push(existingImageUrl);
      }
      result = await falPost('fal-ai/nano-banana-2/edit', {
        prompt: prompt,
        image_urls: image_urls,
        num_images: 1,
        resolution: '1K'
      });
      console.log('NB2 edit risposta:', JSON.stringify(result).slice(0, 300));
      return result?.images?.[0]?.url || '';
    }

    if (model === 'ideogram') {
      result = await falPost('fal-ai/ideogram/v3', {
        prompt: prompt,
        aspect_ratio: '1:1',
        style_type: 'design',
        rendering_speed: 'QUALITY'
      });
      console.log('Ideogram risposta:', JSON.stringify(result).slice(0, 300));
      return result?.images?.[0]?.url || '';
    }

    if (model === 'recraft_svg') {
      result = await falPost('fal-ai/recraft/v4/text-to-vector', {
        prompt: prompt,
        image_size: 'square_hd',
        style: 'vector_illustration'
      });
      console.log('Recraft risposta:', JSON.stringify(result).slice(0, 300));
      return result?.images?.[0]?.url || '';
    }

    console.warn('Modello non riconosciuto:', model);
    return '';

  } catch(error) {
    console.error('ERRORE generateImage:', error.message);
    return '';
  }
}

// ═══════════════════════════════════════════════════
// PARTE 6 — Endpoint di test (apri nel browser)
// https://[tuo-url].railway.app/test
// ═══════════════════════════════════════════════════
app.get('/test', (req, res) => {
  res.json({
    status: 'server online',
    anthropic_key: process.env.ANTHROPIC_API_KEY ? 'presente' : 'MANCANTE',
    fal_key: process.env.FAL_KEY ? 'presente' : 'MANCANTE'
  });
});

// ═══════════════════════════════════════════════════
// PARTE 7 — Avvio
// ═══════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server ideas2wear avviato sulla porta ' + PORT);
});
