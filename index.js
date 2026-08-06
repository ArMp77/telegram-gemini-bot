const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fetch = require('node-fetch');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
  console.error("❌ Faltan las variables TELEGRAM_TOKEN o GROQ_API_KEY en Render.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const historialChats = {};

// VOCABULARIO TÉCNICO PARA GUIAR A WHISPER EN LA TRANSCRIPCIÓN DE AUDIO
const VOCABULARIO_TELECOM = "ThunderNet, ONU LANLY, Mercusys, ZTE, Huawei, Fiberhome, TP-Link, G51S, MR30G, PTB, IPTV, dBm, NAP, fusionado, refusionar, acometida, potencia, sin evidencia fotográfica, sin fluido eléctrico, sin luz en la zona.";

const SYSTEM_PROMPT = `
Eres un asistente técnico de telecomunicaciones para ThunderNet. Tu tarea es extraer la información del ticket y dictado de campo para rellenar una plantilla técnica con máxima precisión.

REGLAS DE ORO:
1. REGLA DE DETECCIÓN DE CONTRATO (Contrato:): Extrae el número de contrato identificando el texto que comienza con el prefijo "CO-" en el ticket original (ejemplo: CO-00040140 - SAN FERNANDO). Aplica esta regla aunque la palabra "Contrato:" no figure expresamente etiquetada en el ticket.

2. REGLA DE FIDELIDAD Y FORMATO DE HARDWARE (ONU Y ROUTER):
   - Mantiene la ortografía correcta de marcas técnicas de telecomunicaciones (ejemplo: LANLY, Mercusys, ZTE, Huawei).
   - Respeta el formato alfanumérico exacto del modelo dictado SIN agregar guiones o espacios innecesarios (ejemplo: si el técnico dicta "TB 5115" o "G 51 S", escríbelo en su formato estándar como "TB5115" o "G51S").
   - Estos campos NUNCA se extraen del ticket; únicamente se completan con el dictado del técnico.

3. REGLA DE COMPLETITUD EN CAMPOS DE ESTADO Y OBSERVACIONES (IPTV / PTB / OBSERVACIÓN):
   - Cuando el técnico reporte estados acompañados de novedades operativas (ejemplo: "activo pero sin luz en la zona", "omitiendo evidencia fotográfica", "sin fluido eléctrico"), DEBES INCLUIR LA NOVEDAD COMPLETA. No resumas únicamente a la palabra "Activo".

4. REGLA ESTRICTA DE MARQUILLA:
   - La Marquilla DEBE SER OBLIGATORIAMENTE un código numérico de 5 o 6 dígitos (ejemplo: 043599 o 036713).
   - Si no aparece explícitamente un código numérico de 5 a 6 dígitos, DEJA EL CAMPO EN BLANCO.

5. REGLA INVIOLABLE DE OBSERVACIÓN: El campo "Observación🔎" DEBE EXTRAERSE ÚNICAMENTE Y EXCLUSIVAMENTE del apartado "Tipo" presente en el ticket inicial. Ignora por completo cualquier otra observación del dictado para este campo específico.

6. REGLA DE REDACCIÓN TÉCNICA EN CORRECTIVOS (Correctivos aplicados👷): Transforma el dictado de esta sección a un lenguaje técnico y profesional de telecomunicaciones/FTTH (ej. "Fusión y empalme de fibra óptica", "Sustitución de conector mecánico/UPC", "Reemplazo de tramo de acometida").

7. NUNCA EXPLIQUES TU RAZONAMIENTO EN LA SALIDA. No agregues frases explicativas entre paréntesis. Entrega ÚNICAMENTE los datos finales.

PLANTILLA DE SALIDA OBLIGATORIA:

Nro. de Ticket: [Extraer del ticket]
Nombre del Cliente: [Extraer del ticket]
Contrato: [Extraer del ticket buscando el texto que inicia con CO-]

Nro. de Ticket📋: [Extraer del ticket]
Nombre del Cliente🆔: [Extraer del ticket]
Contrato📝: [Extraer del ticket buscando el texto que inicia con CO-]

Marca de Onu📶: [Valor dictado]
Modelo de Onu📶: [Valor dictado sin guiones innecesarios]
Marca del router🛜: [Valor dictado]
Modelo del router🛜: [Valor dictado]

Observación🔎: [Extraer ÚNICAMENTE del campo "Tipo" del ticket original]

Falla🚨: [Extraer del dictado/texto]

Correctivos aplicados👷: [Extraer del dictado/texto formalizado técnicamente]

Materiales⚒️:
[Lista de materiales o N/A]

IPTV📺 / PTB: [Extraer del dictado/texto incluyendo novedades como falta de luz o fotos si se mencionan]

Potencias⚡️: [Potencia dBm / Potencia dBm (distancia en metros con m final, ej: 5024m)]

Técnicos: Equipo #04 Alfredo Meléndez/Alexis González
`;

async function procesarMensaje(msg) {
  const chatId = msg.chat.id;

  try {
    if (msg.text) {
      bot.sendMessage(chatId, "⏳ Generando reporte...");
      historialChats[chatId] = msg.text;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `ENTRADA DEL TÉCNICO:\n${msg.text}` }
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.0
      });

      const respuesta = completion.choices[0]?.message?.content || "No se pudo generar respuesta.";
      bot.sendMessage(chatId, respuesta);
    } 
    else if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Transcribiendo audio y generando reporte...");

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();

      // MEJORA CLAVE: Se añade el parámetro 'prompt' a Whisper para guiar el vocabulario técnico
      const transcription = await groq.audio.transcriptions.create({
        file: await Groq.toFile(buffer, "audio.ogg"),
        model: "whisper-large-v3",
        language: "es",
        prompt: VOCABULARIO_TELECOM, // Fuerza a Whisper a entender las marcas y jerga exacta
        temperature: 0.0
      });

      const textoAudio = transcription.text;
      const contextoPrevio = historialChats[chatId] ? `TICKET PREVIO RECIBIDO:\n${historialChats[chatId]}\n\n` : "";

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${contextoPrevio}DICTADO DE CAMPO TRANSCITO:\n${textoAudio}` }
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.0
      });

      const respuesta = completion.choices[0]?.message?.content || "No se pudo generar respuesta.";
      bot.sendMessage(chatId, respuesta);
    }
  } catch (error) {
    console.error('❌ ERROR PROCESANDO MENSAJE:', error);
    bot.sendMessage(chatId, '❌ Hubo un error procesando la información.');
  }
}

app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  if (req.body && req.body.message) {
    procesarMensaje(req.body.message);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot activo con Webhook (Groq Engine)'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor activo en puerto ${PORT}`);

  if (process.env.RENDER_EXTERNAL_URL) {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook registrado en: ${webhookUrl}`);
    } catch (err) {
      console.error('❌ Error registrando Webhook:', err.message);
    }
  }
});
