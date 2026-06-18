// api/ask-ia.js
// Flujo optimizado: Gemini (Principal) -> Groq (Respaldo IA) -> Diccionario Local (Emergencia)

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
- Solo hablás de los servicios de Digital-Flow.
- Si detectás que la persona muestra intención real de contratar (quiere avanzar, pide precio final, dice "quiero arrancar", "cómo contrato", etc.), agregá al final exactamente esta frase: "Te paso directo con nosotros por WhatsApp: https://wa.me/5492616616758"
- No inventes precios de servicios que no sean el de $35.000 ARS (ese es el único precio fijo conocido; el resto es "a cotizar").
`;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const PROVIDER_TIMEOUT_MS = 3000; // 3 segundos de tolerancia por proveedor

// ---------- DICCIONARIO LOCAL DE EMERGENCIA ----------
const LOCAL_DICTIONARY = {
  precio: "Nuestra landing page con bot inteligente tiene un valor de entrada de $35.000 ARS. El resto de los servicios se cotizan a medida según tus necesidades.",
  landing: "Ofrecemos landing pages profesionales con bot inteligente integrado por $35.000 ARS, ideal para captar clientes en piloto automático.",
  bot: "Desarrollamos bots inteligentes para Telegram y WhatsApp Business, automatizando tus respuestas y mejorando tu atención al cliente.",
  redes: "Nos encargamos del armado, optimización y gestión de tus redes sociales para mejorar la presencia digital de tu negocio.",
  google: "Optimizamos tu perfil de Google Business y SEO local para que aparezcas en los primeros lugares cuando busquen tus servicios.",
  contacto: "Podés comunicarte directamente con nosotros para coordinar. Te dejo nuestro WhatsApp: https://wa.me/5492616616758",
  defecto: "¡Hola! Somos Digital-Flow. Ofrecemos landing pages con bot por $35.000 ARS, desarrollo de apps, bots de WhatsApp/Telegram y gestión de redes. ¿En qué servicio estás interesado?"
};

function getLocalFallbackResponse(question) {
  const q = question.toLowerCase();
  let baseAnswer = LOCAL_DICTIONARY.defecto;

  if (q.includes("precio") || q.includes("cuanto cuesta") || q.includes("valor")) {
    baseAnswer = LOCAL_DICTIONARY.precio;
  } else if (q.includes("landing") || q.includes("pagina") || q.includes("web")) {
    baseAnswer = LOCAL_DICTIONARY.landing;
  } else if (q.includes("bot") || q.includes("telegram") || q.includes("whatsapp")) {
    baseAnswer = LOCAL_DICTIONARY.bot;
  } else if (q.includes("redes") || q.includes("instagram") || q.includes("facebook")) {
    baseAnswer = LOCAL_DICTIONARY.redes;
  } else if (q.includes("google") || q.includes("mapa") || q.includes("seo") || q.includes("local")) {
    baseAnswer = LOCAL_DICTIONARY.google;
  } else if (q.includes("contacto") || q.includes("telefono") || q.includes("mensaje") || q.includes("llamar")) {
    baseAnswer = LOCAL_DICTIONARY.contacto;
  }

  if (q.includes("quiero") || q.includes("contratar") || q.includes("comprar") || q.includes("arrancar")) {
    baseAnswer += " Te paso directo con nosotros por WhatsApp: https://wa.me/5492616616758";
  }

  return baseAnswer;
}

// ---------- Proveedor 1: Gemini ----------
async function callGemini(apiKey, question) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${SYSTEM_CONTEXT}\n\nPregunta del usuario: ${question}` }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`Gemini falló con estado ${res.status}. Pasando al siguiente recurso...`);
      return { ok: false };
    }

    const data = await res.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return answer ? { ok: true, answer } : { ok: false };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error o Timeout en Gemini:", err.message);
    return { ok: false };
  }
}

// ---------- Proveedor 2: Groq ----------
async function callGroq(apiKey, question) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
      console.warn(`Groq falló con estado ${res.status}.`);
      return { ok: false };
    }

    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    return answer ? { ok: true, answer } : { ok: false };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error o Timeout en Groq:", err.message);
    return { ok: false };
  }
}

// ---------- Handler Servidor Principal ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  
  const { question } = req.body || {};
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  // 1) Intentar con Gemini
  if (process.env.GEMINI_API_KEY) {
    const geminiResult = await callGemini(process.env.GEMINI_API_KEY, question);
    if (geminiResult.ok) {
      return res.status(200).json({ answer: geminiResult.answer, provider: 'gemini' });
    }
  }

  // 2) Si Gemini falla o agota cuota, intentar con Groq
  if (process.env.GROQ_API_KEY) {
    console.log("Gemini no disponible. Ejecutando consulta de respaldo en Groq...");
    const groqResult = await callGroq(process.env.GROQ_API_KEY, question);
    if (groqResult.ok) {
      return res.status(200).json({ answer: groqResult.answer, provider: 'groq' });
    }
  }

  // 3) Respaldo Absoluto Local (Por si caen ambas APIs)
  console.error('Alerta: Las APIs de IA fallaron. Activando diccionario inteligente de emergencia.');
  const finalEmergencyAnswer = getLocalFallbackResponse(question);
  return res.status(200).json({ answer: finalEmergencyAnswer, provider: 'local_dictionary' });
}