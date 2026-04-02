// ═══════════════════════════════════════════════════
// PARTE 1 — Setup
// ═══════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fal = require("@fal-ai/serverless-client");

const app = express();
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

fal.config({
  credentials: process.env.FAL_KEY
});

// ═══════════════════════════════════════════════════
// PARTE 2 — System Prompt
// ═══════════════════════════════════════════════════
const SYSTEM_PROMPT = `
Sei l'assistente virtuale di ideas2wear.eu.

Rispondi SEMPRE e SOLO con JSON valido.

{
  "message": "testo in italiano",
  "model": "nano_banana_2 | nano_banana_2_edit | ideogram | recraft_svg",
  "prompt": "prompt in inglese",
  "history": []
}
`;

// ═══════════════════════════════════════════════════
// PARTE 3 — Endpoint principale
// ═══════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { user_input, history_json, image_url } = req.body;

    let history = [];
    try {
      history = JSON.parse(history_json || '[]');
    } catch {
      history = [];
    }

    let userText = user_input || '';
    if (image_url && image_url.trim() !== '') {
      userText += ' [Immagine caricata: ' + image_url + ']';
    }

    history.push({ role: 'user', content: userText });

    const claudeResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });

    let parsed;
    try {
      const text = claudeResponse.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
      console.log("RISPOSTA CLAUDE:", parsed);
    } catch {
      return res.json({
        claude_message: 'Errore nella risposta AI. Riprova.',
        design_url: '',
        history_json: JSON.stringify(history)
      });
    }

    let designUrl = '';
    if (parsed.model && parsed.prompt) {
      designUrl = await generateImage(
        parsed.model,
        parsed.prompt,
        image_url
      );
    }

    history.push({
      role: 'assistant',
      content: JSON.stringify({
        message: parsed.message,
        model_used: parsed.model,
        design_url: designUrl
      })
    });

    res.json({
      claude_message: parsed.message,
      design_url: designUrl,
      history_json: JSON.stringify(history)
    });

  } catch (error) {
    console.error('Errore endpoint:', error);
    res.status(500).json({
      claude_message: 'Errore server.',
      design_url: '',
      history_json: req.body.history_json || '[]'
    });
  }
});

// ═══════════════════════════════════════════════════
// PARTE 4 — Generazione immagini
// ═══════════════════════════════════════════════════
async function generateImage(model, prompt, existingImageUrl) {
  try {

    // NANO BANANA 2
    if (model === 'nano_banana_2') {
      const result = await fal.subscribe('fal-ai/nano-banana-2', {
        input: {
          prompt,
          image_size: 'square_hd',
          num_images: 1,
          output_format: 'png'
        }
      });

      return result?.data?.images?.[0]?.url || '';
    }

    // EDIT
    if (model === 'nano_banana_2_edit') {
      const imageUrls = [];

      if (existingImageUrl && existingImageUrl.trim() !== '') {
        imageUrls.push(existingImageUrl);
      }

      const result = await fal.subscribe('fal-ai/nano-banana-2/edit', {
        input: {
          prompt,
          image_urls: imageUrls,
          num_images: 1,
          resolution: '1K',
          output_format: 'png'
        }
      });

      return result?.data?.images?.[0]?.url || '';
    }

    // IDEOGRAM
    if (model === 'ideogram') {
  console.log("⚠️ Ideogram non disponibile, uso fallback");

  const result = await fal.subscribe('fal-ai/nano-banana-2', {
    input: {
      prompt,
      image_size: 'square_hd',
      num_images: 1
    }
  });

  return result?.data?.images?.[0]?.url || '';
}

    // RECRAFT SVG
    if (model === 'recraft_svg') {
      const result = await fal.subscribe('fal-ai/recraft/v4/text-to-vector', {
        input: {
          prompt,
          image_size: 'square_hd',
          style: 'vector_illustration'
        }
      });

      return result?.data?.images?.[0]?.url || '';
    }

    return '';

  } catch (error) {
    console.error('Errore generazione immagine:', error);
    return '';
  }
}

// ═══════════════════════════════════════════════════
// PARTE 5 — Avvio server
// ═══════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Server avviato sulla porta ' + PORT);
});
