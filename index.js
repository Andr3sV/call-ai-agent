import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio";

// Cargar variables de entorno
dotenv.config();

const {
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

// Verificar variables de entorno obligatorias
if (!ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error("[Error] Faltan variables de entorno obligatorias");
  process.exit(1);
}

// Inicializar Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Inicializar Twilio
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const PORT = process.env.PORT || 8000;

// **Ruta de prueba para comprobar que el servidor está activo**
fastify.get("/", async (_, reply) => {
  reply.send({ message: "Server is running" });
});

// **Ruta para llamadas entrantes desde Twilio**
fastify.all("/incoming-call-eleven", async (request, reply) => {
  console.log("[Twilio] Recibida solicitud de llamada entrante");

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// **WebSocket para manejar el stream de Twilio**
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get("/media-stream", { websocket: true }, (connection, req) => {
    console.info("[Server] Conectado al stream de Twilio");

    let streamSid = null;
    const elevenLabsWs = new WebSocket(
      `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`
    );

    elevenLabsWs.on("open", () => console.log("[II] Conectado a ElevenLabs"));
    elevenLabsWs.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        handleElevenLabsMessage(message, connection);
      } catch (error) {
        console.error("[II] Error al parsear mensaje:", error);
      }
    });

    elevenLabsWs.on("close", (code, reason) => {
      console.log(`[II] WebSocket de ElevenLabs cerrado. Código: ${code}, Razón: ${reason}`);
    });
    

const handleElevenLabsMessage = (message, connection) => {
  switch (message.type) {
    case "conversation_initiation_metadata":
      console.info("[II] Recibidos metadatos de inicio de conversación.");
      break;
    case "audio":
      if (message.audio_event?.audio_base_64) {
        const audioData = {
          event: "media",
          streamSid,
          media: {
            payload: message.audio_event.audio_base_64,
          },
        };
        connection.send(JSON.stringify(audioData));
      }
      break;
    case "transcription": // 🆕 Captura la transcripción de la conversación
      if (message.text) {
        console.log("[II] Transcripción recibida:", message.text);
      }
      break;
    case "interruption":
      connection.send(JSON.stringify({ event: "clear", streamSid }));
      break;
    case "ping":
      if (message.ping_event?.event_id) {
        const pongResponse = {
          type: "pong",
          event_id: message.ping_event.event_id,
        };
        elevenLabsWs.send(JSON.stringify(pongResponse));
      }
      break;
  }
};


    connection.on("message", async (message) => {
      try {
        const data = JSON.parse(message);
        switch (data.event) {
          case "start":
            streamSid = data.start.streamSid;
            console.log(`[Twilio] Stream iniciado con ID: ${streamSid}`);
            break;
          case "media":
            if (elevenLabsWs.readyState === WebSocket.OPEN) {
              console.log("[Twilio → ElevenLabs] Enviando audio...");
              console.log("Audio Base64:", data.media.payload.substring(0, 50) + "..."); // Muestra solo una parte para evitar logs enormes
              
              const audioMessage = {
                user_audio_chunk: Buffer.from(data.media.payload, "base64").toString("base64"),
              };
              elevenLabsWs.send(JSON.stringify(audioMessage));
            } else {
              console.log("[Error] WebSocket de ElevenLabs no está abierto.");
            }
            break;
          case "stop":
            elevenLabsWs.close();
            break;
          default:
            console.log(`[Twilio] Recibido evento no manejado: ${data.event}`);
        }
      } catch (error) {
        console.error("[Twilio] Error procesando mensaje:", error);
      }
    });
    

    connection.on("close", () => {
      elevenLabsWs.close();
      console.log("[Twilio] Cliente desconectado");
    });
  });
});

// **Ruta para iniciar una llamada saliente**
fastify.post("/make-outbound-call", async (request, reply) => {
  console.log("[Solicitud recibida] Make.com ha enviado:", request.body);

  // **Verificar Content-Type**
  if (!request.body || typeof request.body !== "object") {
    console.error("[Error] Request sin body JSON válido");
    return reply.status(400).send({ error: "El cuerpo de la solicitud debe ser JSON" });
  }

  const { to } = request.body;

  if (!to) {
    console.error("[Error] No se proporcionó número de destino");
    return reply.status(400).send({ error: "El número de destino es obligatorio" });
  }

  try {
    const call = await twilioClient.calls.create({
      url: `https://${request.headers.host}/incoming-call-eleven`,
      to: to,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`[Twilio] Llamada en progreso: ${call.sid}`);
    reply.send({ message: "Llamada iniciada", callSid: call.sid });
  } catch (error) {
    console.error("[Twilio] Error al iniciar la llamada:", error);
    reply.status(500).send({ error: "Error en Twilio: " + error.message });
  }
});

// **Iniciar el servidor**
fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {

  if (err) {
    console.error("[Error] No se pudo iniciar el servidor:", err);
    process.exit(1);
  }
  console.log(`[Server] Escuchando en el puerto ${PORT}`);
});
