// ═══════════════════════════════════════════════════
// PARTE 1 — Setup: importa le librerie necessarie
// ═══════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { fal } = require('@fal-ai/client');
// Crea il server web
const app = express();
app.use(express.json({ limit: '10mb' }));
// Configura i client con le chiavi API
// (le chiavi vengono lette dalle variabili Railway, non scritte qui)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
fal.config({
  credentials: process.env.FAL_KEY
});
// ═══════════════════════════════════════════════════
// PARTE 2 — Il manuale di istruzioni per Claude
// Questo testo spiega a Claude il suo ruolo e
// come deve rispondere. E' il punto piu' importante.
// ═══════════════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente virtuale di ideas2wear.eu, un servizio
di magliette personalizzate con design AI.
 
Il tuo ruolo:
1. Capire cosa vuole l'utente
2. Scegliere il modello AI giusto
3. Costruire un prompt ottimizzato in inglese
4. Rispondere all'utente in italiano in modo amichevole
 
REGOLA ASSOLUTA: rispondi SEMPRE e SOLO con un oggetto
JSON valido. Zero testo prima o dopo il JSON.
 
=== COME SCEGLIERE IL MODELLO ===
 
Usa "nano_banana_2" quando:
- L'utente descrive un soggetto (animale, personaggio,
  oggetto, paesaggio, scena, stile artistico)
- L'utente chiede cartoon, anime, fotorealismo, acquerello,
  stile fumetto, pop art, o qualsiasi stile visivo
- Non ci sono scritte nel design
 
Usa "nano_banana_2_edit" quando:
- L'utente ha CARICATO una sua foto (image_url non vuoto)
- L'utente chiede di modificare il design precedente
  (es: cambia colore, aggiungi elemento, trasforma stile)
 
Usa "ideogram" quando:
- Il design include testo: scritte, slogan, nomi, numeri,
  citazioni, loghi con parole, frasi motivazionali
- QUALSIASI design che contiene parole visibili
 
Usa "recraft_svg" quando:
- L'utente chiede un logo SENZA testo
- L'utente chiede icone, simboli, elementi di brand
- L'utente usa parole come "scalabile", "vettoriale",
  "logo pulito", "icona"
 
=== COME COSTRUIRE IL PROMPT (sempre in inglese) ===
 Per TUTTI i design aggiungi sempre:
- white or transparent background
- suitable for t-shirt printing, high contrast
- graphic design style (non fotografia realistica)
- bold vivid colors
 
Per Nano Banana 2 (design generici):
- Descrivi soggetto, azione, stile, colori, umore
- Aggiungi: vector art style, clean lines
 
Per Ideogram (con testo):
- Includi il testo ESATTO tra virgolette nel prompt
- Aggiungi: typography design, clear readable text
 
Per Recraft SVG (loghi):
- Descrivi forma, stile, colori HEX se specificati
- Aggiungi: minimalist, professional, vector illustration
 
=== FORMATO RISPOSTA JSON OBBLIGATORIO ===
{
  "message": "risposta in italiano per l'utente,
              amichevole e descrittiva",
  "model": "nano_banana_2 | nano_banana_2_edit |
            ideogram | recraft_svg",
  "prompt": "prompt ottimizzato in inglese",
  "history": [array COMPLETO della conversazione
              aggiornato con questo scambio]
}
`;
// ═══════════════════════════════════════════════════
// PARTE 3 — Endpoint principale /api/chat
// Questo è il punto di ingresso chiamato da Landbot
// ═══════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    // 1. Ricevi i dati da Landbot
    const {
      user_input,     // messaggio scritto dall'utente
      history_json,   // conversazione precedente
      image_url       // URL foto caricata (se presente)
    } = req.body;
 
    // 2. Ricostruisce la history della conversazione
    let history = [];
    try {
      history = JSON.parse(history_json || '[]');
    } catch(e) {
      history = [];
    }
 
    // 3. Aggiunge il nuovo messaggio dell'utente alla history
    let userText = user_input || '';
    if (image_url && image_url.trim() !== '') {
      userText += ' [Immagine caricata: ' + image_url + ']';
    }
history.push({ role: 'user', content: userText });
 
    // 4. Chiama Claude per analizzare e decidere
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });
 
    // 5. Estrae il JSON dalla risposta di Claude
    let parsed;
    try {
      const text = claudeResponse.content[0].text;
      // Cerca il JSON anche se c'è testo intorno
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {
      // Se Claude non risponde in JSON, gestisci l'errore
      return res.json({
        claude_message: 'Scusa, ho avuto un problema tecnico. Riprova!',
        design_url: '',
        history_json: history_json || '[]'
      });
    }
 
    // 6. Genera l'immagine con il modello scelto da Claude
    let designUrl = '';
    if (parsed.model && parsed.model !== 'none' && parsed.prompt) {
      designUrl = await generateImage(
        parsed.model,
        parsed.prompt,
        image_url
      );
    }
 
    // 7. Aggiorna la history con la risposta di Claude
    history.push({
      role: 'assistant',
      content: JSON.stringify({
        message: parsed.message,
        model_used: parsed.model,
        design_url: designUrl
      })
    });
 
    // 8. Risponde a Landbot con tutto il necessario
    res.json({
      claude_message: parsed.message,
      design_url: designUrl,
      history_json: JSON.stringify(history)
    });
 
  } catch (error) {
    console.error('Errore endpoint /api/chat:', error.message);
    res.status(500).json({
      claude_message: 'Errore tecnico. Riprova tra qualche secondo!',
      design_url: '',
      history_json: req.body.history_json || '[]'
});
  }
});
// ═══════════════════════════════════════════════════
// PARTE 4 — Funzione generateImage
// Chiama fal.ai con il modello giusto
// ═══════════════════════════════════════════════════
async function generateImage(model, prompt, existingImageUrl) {
  try {
 
    // NANO BANANA 2 — genera nuova immagine da testo
    if (model === 'nano_banana_2') {
      const result = await fal.subscribe('fal-ai/nano-banana-2', {
        input: {
          prompt: prompt,
          image_size: 'square_hd',  // 1024x1024 px
          num_images: 1,
          output_format: 'png'
        }
      });
      return result.data.images[0].url;
    }
 
    // NANO BANANA 2 EDIT — modifica immagine esistente
    if (model === 'nano_banana_2_edit') {
      const imageUrls = [];
      // Se c'è un'immagine caricata o un design precedente, usala
      if (existingImageUrl && existingImageUrl.trim() !== '') {
        imageUrls.push(existingImageUrl);
      }
      const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
        input: {
          prompt: prompt,
          image_urls: imageUrls,
          num_images: 1,
          resolution: '1K',
          output_format: 'png'
        }
      });
      return result.data.images[0].url;
    }
 
    // IDEOGRAM V3 — design con testo e scritte
    if (model === 'ideogram') {
      const result = await fal.subscribe('fal-ai/ideogram/v3', {
        input: {
          prompt: prompt,
          aspect_ratio: '1:1',
          style_type: 'design',
          rendering_speed: 'QUALITY',
          num_images: 1
        }
      });
      return result.data.images[0].url;
// RECRAFT V4 SVG — loghi e vettoriali
    if (model === 'recraft_svg') {
      const result = await fal.subscribe(
        'fal-ai/recraft/v4/text-to-vector', {
        input: {
          prompt: prompt,
          image_size: 'square_hd',
          style: 'vector_illustration'
        }
      });
      return result.data.images[0].url;
    }
 
    return ''; // Se il modello non è riconosciuto
 
  } catch(error) {
    console.error('Errore generazione immagine:', error.message);
    return ''; // In caso di errore restituisce stringa vuota
  }
}
 
// ═══════════════════════════════════════════════════
// PARTE 5 — Avvia il server
// ═══════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server ideas2wear avviato sulla porta ' + PORT);
});

