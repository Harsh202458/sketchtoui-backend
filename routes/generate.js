const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { uploadToCloudinary } = require('../config/cloudinary');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Step 1 prompt: detect components only, return simple JSON
const COMPONENTS_PROMPT = `You are a UI layout analyser. Look at this image carefully.

Identify all UI components visible in this screen or wireframe sketch.
Return ONLY a valid JSON object in this exact format with no extra text, no markdown, no backticks:

{"screen_title":"detected screen name","components":[{"type":"AppBar","label":"title text"},{"type":"TextField","label":"placeholder text"}],"layout":"column"}

Common component types: AppBar, TextField, ElevatedButton, OutlinedButton, Card, ListView, GridView, BottomNavigationBar, FloatingActionButton, Image, Text, Row, Column, Divider, Chip, Switch, Checkbox, TabBar, SearchBar, Avatar, Badge.

Return ONLY the JSON. No explanation.`;

// Step 2 prompt: generate Flutter code from component list
const CODE_PROMPT = (screenTitle, components) =>
`You are a Flutter developer. Generate a complete Flutter StatelessWidget Dart class for a screen called "${screenTitle}".

The screen contains these UI components:
${components.map(c => `- ${c.type}: "${c.label}"`).join('\n')}

Rules:
- Output ONLY the Dart widget class code, nothing else
- Do NOT include import statements
- Do NOT include void main()
- Use Material 3 widgets
- Use Scaffold as root
- Use placeholder colors like Colors.blue, Colors.grey
- Use const where possible
- Make it look clean and professional

Output only the raw Dart code, no markdown, no backticks, no explanation.`;

// Robust JSON extractor - finds first valid JSON object in messy text
function extractJSON(text) {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Find JSON by locating first { and last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (_) {}
  }

  throw new Error('Could not extract valid JSON from Gemini response');
}

// POST /api/generate
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });

  const screenName = req.body.screen_name || 'Untitled Screen';

  try {
    // 1. Upload image to Cloudinary
    const imageUrl = await uploadToCloudinary(req.file.buffer);
    console.log('Image uploaded to Cloudinary:', imageUrl);

    const callGeminiWithFallback = async (contents) => {
      const candidateModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
      let lastError;
      for (const modelName of candidateModels) {
        try {
          const m = genAI.getGenerativeModel({ model: modelName });
          const res = await m.generateContent(contents);
          return res.response.text();
        } catch (e) {
          console.warn(`Model ${modelName} failed (${e.message}), trying next fallback...`);
          lastError = e;
        }
      }
      throw lastError;
    };

    const imageData = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype || 'image/jpeg'
      }
    };

    // 2. Step 1 — Detect components (small JSON response, very reliable)
    let components = [];
    let screenTitle = screenName;

    try {
      const step1Text = await callGeminiWithFallback([COMPONENTS_PROMPT, imageData]);
      console.log('Gemini Step 1 raw:', step1Text.slice(0, 300));
      const step1Data = extractJSON(step1Text);
      components = step1Data.components || [];
      screenTitle = step1Data.screen_title || screenName;
      console.log(`Detected ${components.length} components for: ${screenTitle}`);
    } catch (step1Err) {
      console.warn('Step 1 component detection failed, using fallback:', step1Err.message);
      components = [{ type: 'Container', label: 'Screen Layout' }];
    }

    // 3. Step 2 — Generate Flutter code (plain text, no JSON wrapping)
    let flutterCode = '';
    try {
      const step2Text = await callGeminiWithFallback(CODE_PROMPT(screenTitle, components));
      flutterCode = step2Text
        .replace(/```dart/gi, '')
        .replace(/```/g, '')
        .trim();
      console.log('Flutter code generated, length:', flutterCode.length);
    } catch (step2Err) {
      console.warn('Step 2 code generation failed:', step2Err.message);
      flutterCode = `class ${screenTitle.replace(/\s+/g, '')}Screen extends StatelessWidget {
  const ${screenTitle.replace(/\s+/g, '')}Screen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${screenTitle}')),
      body: const Center(child: Text('Layout detected - code generation failed, please retry')),
    );
  }
}`;
    }

    // 4. Save to DB
    await pool.query(
      `INSERT INTO generations (user_id, image_url, detected_components, generated_code, screen_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        imageUrl,
        JSON.stringify(components),
        flutterCode,
        screenTitle
      ]
    );

    // 5. Return result
    res.json({
      success: true,
      screen_title: screenTitle,
      components,
      flutter_code: flutterCode,
      image_url: imageUrl
    });

  } catch (err) {
    console.error('Generation error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate Flutter code' });
  }
});

module.exports = router;

