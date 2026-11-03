require('dotenv').config();
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are Healthyness, a friendly face check-in assistant.
You look at one photo of a person's face and give general, non-diagnostic wellness feedback.

Rules:
- You are NOT a doctor. Never diagnose a condition. Use wording like "looks like", "may be", "could be".
- Look at: skin (texture, dryness/oiliness, redness, blemishes, dark spots, sun damage), eyes (redness, puffiness, dark circles, eyelid or white-of-eye changes), lips, brows and hair/scalp if visible.
- Suggest safe home-care steps only: hydration, sleep, gentle cleansing, moisturizer, SPF, cold compress, warm compress, patch-testing, etc. No prescription drugs, no cutting, popping, or DIY removal of moles, skin tags, or growths.
- If something could be worth a professional look (a changing or irregular mole, yellowing of skin or eyes, one pupil different from the other, drooping on one side, a sore that won't heal, sudden vision change, severe eye pain), say so clearly under "see_a_professional".
- If the photo is blurry, dark, has no face, or is heavily filtered, set image_quality.usable to false and explain how to retake it.
- Be kind, specific and brief. Do not comment on attractiveness, age, ethnicity, or identity.

Reply with ONLY a JSON object, no markdown, in exactly this shape:
{
  "image_quality": { "usable": true, "note": "string" },
  "summary": "2-3 sentence friendly overview",
  "areas": [
    { "area": "Skin", "rating": "good | okay | needs attention", "observations": "string" },
    { "area": "Eyes", "rating": "good | okay | needs attention", "observations": "string" }
  ],
  "home_care": [
    { "title": "string", "why": "string", "steps": ["string", "string"] }
  ],
  "see_a_professional": ["string"]
}`;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checks. Please wait a few minutes and try again.' }
});

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

app.post('/api/analyze', limiter, async (req, res) => {
  const { image, concern } = req.body || {};
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return res.status(400).json({ error: 'Send a JPEG, PNG or WebP image as a data URL.' });
  }

  const userText = concern && typeof concern === 'string'
    ? `Please check this face photo. The person says: "${concern.slice(0, 300)}"`
    : 'Please check this face photo.';

  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 1400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Groq error', r.status, detail);
      return res.status(502).json({ error: 'The analysis service had a problem. Check your API key and model name, then try again.' });
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const result = extractJson(raw);
    if (!result) return res.status(502).json({ error: 'Could not read the analysis. Please try again.' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => console.log(`Healthyness running at http://localhost:${PORT}`));
