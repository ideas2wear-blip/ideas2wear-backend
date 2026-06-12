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
// PARTE 3 — System Prompt
// ═══════════════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente di ideas2wear.eu, magliette personalizzate con AI.
Rispondi SEMPRE e SOLO con un oggetto JSON valido. Zero testo fuori dal JSON.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCELTA MODELLO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "flux_pro": illustrazioni, cartoon, soggetti, stili artistici, fotorealistico, loghi iconici, simboli, elementi grafici senza testo
- "nano_banana_2_edit": SOLO quando nel messaggio è presente il tag [Design precedente generato da modificare: URL] oppure [Immagine caricata: URL]. In TUTTI gli altri casi usa flux_pro.
- "ideogram": quando il design include PAROLE, scritte, slogan, nomi, numeri, citazioni, testo visibile nel design

recraft_svg NON è più disponibile. Per loghi e icone usa flux_pro.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUALITÀ DEL PROMPT — REGOLA FONDAMENTALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Il prompt deve essere LUNGO e RICCO DI DETTAGLI (minimo 80 parole in inglese).
Prompt corti = immagini mediocri. Prompt dettagliati = immagini professionali.

Includi SEMPRE questi elementi nel prompt:
1. SOGGETTO DETTAGLIATO: descrivi forma, postura, espressione, dettagli fisici
2. STILE ARTISTICO PRECISO: non "cartoon" generico, ma "bold graphic novel style", "1960s vintage poster illustration", "Studio Ghibli aesthetic", "Japanese ukiyo-e woodblock print", "Art Nouveau decorative style", "80s neon synthwave art", ecc.
3. TECNICA E TEXTURE: "crisp ink outlines", "flat vector shapes with gradient fills", "rough screen-print texture", "clean digital illustration", "watercolor wash with ink outlines"
4. PALETTE COLORE SPECIFICA: non "colori vivaci" ma "deep cobalt blue, burnt orange, cream white, black outlines"
5. COMPOSIZIONE: "centered subject with ample negative space", "dynamic diagonal composition", "full-bleed illustration", "symmetrical badge design"
6. QUALITÀ TECNICA: aggiungi sempre "ultra-detailed, masterful illustration, professional graphic design, award-winning artwork, crisp clean lines"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENHANCER PER MODELLO — aggiungili SEMPRE in fondo al prompt
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Per flux_pro: "ultra-detailed masterpiece, intricate linework, vibrant rich colors, professional t-shirt graphic, premium print quality, isolated on solid white background"
Per nano_banana_2_edit: "seamlessly integrated edit, maintain original style and color palette, high quality, print-ready"
Per ideogram: "perfect typography, professional kerning, crisp clean design, bold graphic style, print-ready"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STILI ARTISTICI DI RIFERIMENTO — usali quando pertinenti
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Cartoon/Animazione: "bold cartoon style", "thick black outlines, flat cel-shaded colors", "exaggerated proportions, expressive faces"
- Vintage: "retro 1950s Americana poster", "faded letterpress texture", "limited 3-color palette"
- Realistico: "hyper-realistic detailed illustration, photographic quality, dramatic lighting"
- Minimal: "ultra-minimalist single-line art", "geometric flat design, perfect negative space"
- Manga/Anime: "detailed manga ink style, dynamic action lines, dramatic shading"
- Natura: "detailed naturalistic botanical illustration, fine crosshatching, scientific illustration style"
- Streetwear: "bold graffiti-inspired graphic, spray paint texture, urban street art aesthetic"
- Logo/Badge: "clean vector badge design, symmetrical emblem, professional brand identity style"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGOLE CRITICHE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- MAI generare mockup o anteprime di magliette indossate
- MAI chiedere all'utente di caricare un'immagine nel messaggio JSON
- Per sfondo bianco usa SEMPRE: "isolated on solid white background, die-cut sticker style, no drop shadow"
- IMAGE-TO-IMAGE: estrai il soggetto dall'immagine e applica le modifiche richieste. Non descrivere la maglietta.
- Per testo in ideogram: includi le parole ESATTE tra virgolette nel prompt

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VINCOLO DIMENSIONI STAMPA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Area massima: 28 cm larghezza × 40 cm altezza.
Preferire composizioni verticali o quadrate. Soggetto principale centrato.
Nessun elemento importante vicino ai bordi. Layout ottimizzato per stampa DTG/DTF.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO RISPOSTA JSON OBBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "message": "risposta in italiano per l'utente (entusiasta, max 2 righe)",
  "model": "flux_pro",
  "prompt": "prompt dettagliato in inglese, minimo 80 parole"
}
`;

// ═══════════════════════════════════════════════════
// PARTE 4 — Endpoint principale /api/chat
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
      userText += ' [Design precedente generato da modificare: ' + image_url + ']';
    }
    history.push({ role: 'user', content: userText });

    // Chiama Claude
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
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

    // Corregge il modello in base alla presenza di image_url
    if (image_url && image_url.trim() !== '' && parsed.model === 'flux_pro') {
      // Ha immagine ma Claude ha scelto flux_pro → forza edit
      parsed.model = 'nano_banana_2_edit';
      console.log('Modello forzato a nano_banana_2_edit (image_url presente)');
    }
    if ((!image_url || image_url.trim() === '') && parsed.model === 'nano_banana_2_edit') {
      // Nessuna immagine ma Claude ha scelto edit → torna a flux_pro
      parsed.model = 'flux_pro';
      console.log('Modello corretto a flux_pro (nano_banana_2_edit senza image_url)');
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
// PARTE 5 — Funzione generazione immagine
// ═══════════════════════════════════════════════════
async function generateImage(model, prompt, existingImageUrl) {
  try {
    console.log('Chiamo fal.ai con modello:', model);

    let result;

    // ── FLUX 2 Pro — modello principale ──────────────
    if (model === 'flux_pro') {
      result = await falPost('fal-ai/flux-2-pro', {
        prompt: prompt,
        aspect_ratio: '1:1',
        num_images: 1,
        output_format: 'png'
      });
      console.log('FLUX Pro risposta:', JSON.stringify(result).slice(0, 300));
      return result?.images?.[0]?.url || '';
    }

    // ── Nano Banana 2 Edit — image-to-image ──────────
    if (model === 'nano_banana_2_edit') {
      const image_urls = [];
      if (existingImageUrl && existingImageUrl.trim() !== '') {
        image_urls.push(existingImageUrl);
      }

      // Nessuna immagine → fallback silenzioso a flux_pro
      if (image_urls.length === 0) {
        console.warn('nano_banana_2_edit senza image_url — fallback a flux_pro');
        result = await falPost('fal-ai/flux-2-pro', {
          prompt: prompt,
          aspect_ratio: '1:1',
          num_images: 1,
          output_format: 'png'
        });
        console.log('FLUX Pro fallback:', JSON.stringify(result).slice(0, 300));
        return result?.images?.[0]?.url || '';
      }

      // Prova nano_banana_2_edit, se fallisce (URL scaduto) → fallback flux_pro
      try {
        result = await falPost('fal-ai/nano-banana-2/edit', {
          prompt: prompt,
          image_urls: image_urls,
          num_images: 1,
          resolution: '1K'
        });
        console.log('NB2 edit risposta:', JSON.stringify(result).slice(0, 300));
        return result?.images?.[0]?.url || '';
      } catch (editError) {
        console.warn('nano_banana_2_edit fallito (URL probabilmente scaduto):', editError.message);
        console.warn('Fallback a flux_pro con stesso prompt');
        result = await falPost('fal-ai/flux-2-pro', {
          prompt: prompt,
          aspect_ratio: '1:1',
          num_images: 1,
          output_format: 'png'
        });
        console.log('FLUX Pro fallback dopo edit error:', JSON.stringify(result).slice(0, 300));
        return result?.images?.[0]?.url || '';
      }
    }

    // ── Ideogram V3 — design con testo ───────────────
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

    // ── Recraft V3 raster — loghi/icone (PNG, non SVG) ─
    // Sostituisce recraft_svg che generava SVG non visualizzabili in Landbot
    if (model === 'recraft_v3') {
      result = await falPost('fal-ai/recraft/v3/text-to-image', {
        prompt: prompt,
        image_size: 'square_hd',
        style: 'vector_illustration'
      });
      console.log('Recraft V3 risposta:', JSON.stringify(result).slice(0, 300));
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
// ENDPOINT MOCKUP
// ═══════════════════════════════════════════════════
app.post('/api/mockup', async (req, res) => {
  try {
    const { design_url, tipo_prodotto, lato, colore_felpa } = req.body;

    console.log('=== MOCKUP RICHIESTO ===');
    console.log('Prodotto:', tipo_prodotto, '| Lato:', lato);
    console.log('Design URL:', design_url);

    if (!design_url || !design_url.startsWith('http')) {
      console.error('design_url mancante o non valido:', design_url);
      return res.status(400).json({ mockup_url: '', errore: 'design_url mancante o non valido' });
    }

    const tipoNorm = (tipo_prodotto || '').toLowerCase();
    const capo = tipoNorm === 'felpa'
      ? (colore_felpa || 'black') + ' hoodie with hood, flat lay'
      : 'white t-shirt, flat lay';

    const posizione = (lato || '').toLowerCase().includes('retro')
      ? 'on the back, centered'
      : 'on the front, centered';

    const mockupPrompt =
      'Take this exact graphic design and apply it as a flat print ' + posizione + ' of a plain ' + capo + '. ' +
      'The design must be perfectly centered on the garment, not too large and not too small, respecting natural print proportions. ' +
      'Pure white background, clean e-commerce product mockup, flat lay style. ' +
      'No model, no mannequin, no shadows, no props. ' +
      'The graphic must remain faithful to the original design provided.';

    console.log('Mockup prompt:', mockupPrompt);

    const result = await falPost('fal-ai/nano-banana-2/edit', {
      prompt: mockupPrompt,
      image_urls: [design_url],
      num_images: 1,
      resolution: '1K'
    });

    const mockupUrl = result?.images?.[0]?.url || '';
    console.log('Mockup URL:', mockupUrl);

    res.json({ mockup_url: mockupUrl });

  } catch (error) {
    console.error('ERRORE MOCKUP:', error.message);
    res.status(500).json({ mockup_url: '' });
  }
});

// ═══════════════════════════════════════════════════
// PARTE 6 — Endpoint di test
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
