// api/ask-ia.js
// Función serverless de Vercel. Recibe la pregunta del usuario desde el
// frontend, la manda a la API de Gemini con un prompt acotado a los
// servicios de Digital-Flow, y devuelve la respuesta.
//
// La API key de Gemini se lee de una variable de entorno (GEMINI_API_KEY)
// configurada en el panel de Vercel. NUNCA se expone al navegador.

const SYSTEM_CONTEXT = `
Sos el asistente virtual de Digital-Flow, un negocio de servicios IT que ofrece:
- Landing pages con bot inteligente (servicio de entrada, $35.000 ARS)
- Bots de Telegram (con o sin IA)
- Optimización y creación de perfiles de Google Business
- SEO local
- Integración con API de WhatsApp Business
- Dashboards a medida
- Apps simples a medida
- Armado y gestión de redes sociales

Reglas:
- Respondé SIEMPRE en español, tono cercano y profesional, breve (máximo 3 oraciones).
- Solo hablás de los servicios de Digital-Flow. Si preguntan algo totalmente ajeno, redirigí amablemente al tema.
- Si detectás que la persona muestra intención real de contratar (quiere avanzar, pide precio final, dice "quiero arrancar", "cómo contrato", etc.), agregá al final exactamente esta frase: "Te paso directo con nosotros por WhatsApp: https://wa.me/5492616616758"
- No inventes precios de servicios que no sean el de $35.000 ARS (ese es el único precio fijo conocido; el resto es "a cotizar").
`;

const MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 2; // intentos adicionales además del primero
const RETRY_DELAY_MS = 600; // espera base entre reintentos

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Llama a Gemini. Si responde 503 (alta demanda) o 429 (rate limit),
// reintenta con espera progresiva antes de rendirse.
async function callGeminiWithRetry(apiKey, question) {
  let lastErrorText = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${SYSTEM_CONTEXT}\n\nPregunta del usuario: ${question}` }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.4
          }
        })
      }
    );

    if (geminiRes.ok) {
      return { ok: true, data: await geminiRes.json() };
    }

    lastErrorText = await geminiRes.text();
    const isRetryable = geminiRes.status === 503 || geminiRes.status === 429;

    console.error(
      `Intento ${attempt + 1}/${MAX_RETRIES + 1} falló (status ${geminiRes.status}):`,
      lastErrorText
    );

    // Si no es un error reintentable, o ya se acabaron los intentos, salimos.
    if (!isRetryable || attempt === MAX_RETRIES) {
      return { ok: false, status: geminiRes.status, errorText: lastErrorText };
    }

    // Backoff progresivo: 600ms, 1200ms, ...
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }

  return { ok: false, status: 500, errorText: lastErrorText };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY no configurada en el servidor',
      answer: 'El agente de IA todavía no está configurado. Escribinos directo por WhatsApp y te ayudamos al instante.'
    });
  }

  try {
    const result = await callGeminiWithRetry(apiKey, question);

    if (!result.ok) {
      console.error('Error final de Gemini tras reintentos:', result.errorText);
      return res.status(502).json({
        error: 'Error consultando la IA',
        answer: 'Estamos con mucha demanda en este momento. Probá de nuevo en unos segundos, o escribinos directo por WhatsApp.'
      });
    }

    const answer =
      result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'No tengo una respuesta clara para eso. ¿Querés que te derive directo por WhatsApp?';

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('Error inesperado:', err);
    return res.status(500).json({
      error: 'Error interno',
      answer: 'Tuvimos un problema técnico. Escribinos por WhatsApp y lo resolvemos al toque.'
    });
  }
}