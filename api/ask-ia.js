// api/ask-ia.js
// Función serverless de Vercel optimizada con Timeouts y mejor flujo de fallbacks.

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

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_RETRIES = 2; 
const RETRY_DELAY_MS = 600; 
const PROVIDER_TIMEOUT_MS = 3500; // 3.5 segundos máximo por proveedor para evitar el límite de 10s de Vercel

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Proveedor 1: Gemini ----------
async function callGemini(apiKey, question) {
  let lastErrorText = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Creamos un controlador para abortar la petición si tarda demasiado
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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
            generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
          }),
          signal: controller.signal // Asignamos el signal de aborto
        }
      );

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (answer) return { ok: true, answer };
        lastErrorText = 'Respuesta vacía de Gemini';
      } else {
        lastErrorText = await res.text();
        
        // CRÍTICO: Si el error es 429 (Cuota Diaria Excedida), NO tiene sentido reintentar.
        // Saltamos directo al fallback de Groq para ahorrar tiempo.
        if (res.status === 429) {
          console.warn('Gemini sin cuota diaria (429). Saltando directo a Groq...');
          return { ok: false, errorText: lastErrorText };
        }
      }

      // Si es un error 503 (Alta demanda temporal de la API), sí podemos reintentar.
      const isRetryable = res.status === 503;
      console.warn(`Gemini intento ${attempt + 1}/${MAX_RETRIES + 1} falló de forma intermitente:`, lastErrorText);

      if (!isRetryable || attempt === MAX_RETRIES) {
        return { ok: false, errorText: lastErrorText };
      }

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        lastErrorText = 'Timeout excedido en Gemini';
        console.warn('Gemini tardó demasiado en responder (Timeout).');
      } else {
        lastErrorText = String(err);
        console.warn('Error de red en Gemini:', err);
      }

      if (attempt === MAX_RETRIES) return { ok: false, errorText: lastErrorText };
    }

    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }

  return { ok: false, errorText: lastErrorText };
}

// ---------- Proveedor 2: Groq (respaldo) ----------
async function callGroq(apiKey, question) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_CONTEXT },
          { role: 'user', content: question }
        ],
        max_tokens: 200,
        temperature: 0.4
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      console.error('Groq falló de forma crítica:', errText);
      return { ok: false, errorText: errText };
    }

    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) return { ok: false, errorText: 'Respuesta vacía de Groq' };

    return { ok: true, answer };

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('Groq tardó demasiado en responder (Timeout).');
      return { ok: false, errorText: 'Timeout excedido en Groq' };
    }
    console.error('Error inesperado llamando a Groq:', err);
    return { ok: false, errorText: String(err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  const fallbackAnswer =
    "Esa consulta necesita un poco más de detalle de nuestro lado. Para no hacerte esperar, escribinos directo y te respondemos al toque: <a class='wsp-link' href='https://wa.me/5492616616758' target='_blank' rel='noopener'>Hablar por WhatsApp →</a>";

  try {
    // 1) Intentar con Gemini
    if (geminiKey) {
      const geminiResult = await callGemini(geminiKey, question);
      if (geminiResult.ok) {
        return res.status(200).json({ answer: geminiResult.answer, provider: 'gemini' });
      }
      // Usamos console.warn para que tus logs diarios queden limpios y no asusten en Vercel
      console.warn('Gemini no disponible, intentando activar respaldo con Groq...');
    } else {
      console.warn('GEMINI_API_KEY no configurada, probando con Groq...');
    }

    // 2) Probar con Groq
    if (groqKey) {
      const groqResult = await callGroq(groqKey, question);
      if (groqResult.ok) {
        return res.status(200).json({ answer: groqResult.answer, provider: 'groq' });
      }
      console.error('Groq también falló en el proceso.');
    } else {
      console.error('GROQ_API_KEY no configurada.');
    }

    // 3) Ambos fallaron de verdad: devolvemos tu lindo mensaje sin romper la experiencia del cliente
    return res.status(200).json({ answer: fallbackAnswer, provider: 'none' });

  } catch (err) {
    console.error('Error crítico e inesperado en el handler general:', err);
    return res.status(200).json({ answer: fallbackAnswer, provider: 'none' });
  }
}