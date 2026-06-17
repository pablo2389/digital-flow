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
- Si te preguntan por los tiempos de entrega, aclará que una landing page estándar tarda entre 5 y 7 días hábiles.
- Si te preguntan por métodos de pago o USD, aclará que aceptamos transferencias en pesos argentinos y también pagos en dólares (USD) mediante Binance o PayPal.
- Si detectás que la persona muestra intención real de contratar (quiere avanzar, pide precio final, dice "quiero arrancar", "cómo contrato", etc.), agregá al final exactamente esta frase: "Te paso directo con nosotros por WhatsApp: https://wa.me/5490000000000"
- No inventes precios de servicios que no sean el de $35.000 ARS (ese es el único precio fijo conocido; el resto es "a cotizar").
`;



export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

 const question = req.body?.question || req.body?.message;

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
    const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
            maxOutputTokens: 1000,
            temperature: 0.4
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Error de Gemini:', errText);
      return res.status(502).json({
        error: 'Error consultando la IA',
        answer: 'No pude procesar tu consulta en este momento. Escribinos por WhatsApp y te respondemos directo.'
      });
    }

    const data = await geminiRes.json();
    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
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