const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');

// Inicializar servidores e instancias
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// System Prompt de extracción flexible
const SYSTEM_PROMPT = `
Eres un asistente técnico de telecomunicaciones para la empresa ThunderNet.

INSTRUCCIONES DE EXTRACCIÓN FLEXIBLE:
1. Recibirás un ticket de avería de fibra óptica en texto y/o el dictado (texto o nota de voz) enviado por el técnico Alfredo Meléndez.
2. El técnico dictará los datos de campo EN CUALQUIER ORDEN, con lenguaje informal, pausado o con correcciones sobre la marcha.
3. Identifica contextualmente qué significa cada dato sin importar la secuencia en que lo mencione. Si se corrige durante el audio, toma únicamente la última versión.
4. Si un campo no es mencionado ni en el ticket ni en el dictado, escribe "N/A".

PLANTILLA DE SALIDA OBLIGATORIA (No agregues introducciones ni saludos):

Nro. de Ticket: [Extraer del ticket]

Nombre del Cliente: [Extraer del ticket]

Contrato: [Extraer del ticket]

Nap : [Extraer del dictado/texto]
Puerto : [Extraer del dictado/texto]
Marquilla : [Extraer del dictado/texto]

Marca de Onu : [Extraer del dictado/texto]
Modelo de Onu: [Extraer del dictado/texto]
Marca del router: [Extraer del dictado/texto]
Modelo del router: [Extraer del dictado/texto]

Observación🔎 [Extraer del ticket o dictado]

Falla🚨: [Extraer del dictado/texto]

Correctivos aplicados👷: [Extraer del dictado/texto]

Materiales⚒️:
[Extraer lista de materiales del dictado/texto]

IPTV📺: [Extraer del dictado/texto]

Potencias⚡️: [Extraer del dictado/texto o mantener la del ticket si no se indica otra]

Técnico: Alfredo Meléndez
`;

// Procesar mensajes de texto y notas de voz
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  try {
    let contents = [];

    // Si el mensaje es una nota de voz
    if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Procesando audio y generando reporte...");
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      
      // Descargar audio en memoria
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      contents = [
        {
          inlineData: {
            mimeType: 'audio/ogg',
            data: base64Audio
          }
        },
        { text: SYSTEM_PROMPT }
      ];
    } 
    // Si el mensaje es un texto (ticket o dictado escrito)
    else if (msg.text) {
      bot.sendMessage(chatId, "⏳ Generando reporte...");
      contents = [
        { text: SYSTEM_PROMPT },
        { text: `Entrada del técnico:\n${msg.text}` }
      ];
    } else {
      return;
    }

    // Llamada a Gemini 1.5 Flash
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: contents,
    });

    const reporteFinal = response.text;
    bot.sendMessage(chatId, reporteFinal);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
    bot.sendMessage(chatId, '❌ Hubo un error procesando la información. Inténtalo de nuevo.');
  }
});

// Servidor web mínimo para mantener vivo el servicio en la nube
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo'));
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));