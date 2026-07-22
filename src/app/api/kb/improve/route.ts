import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { chatJson, type ChatMessage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const improveInputSchema = z.object({
  kind: z.enum(["qa", "block", "category", "product"]),
  question: z.string().optional(),
  answer: z.string().optional(),
  content: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const improveOutputSchema = z.object({
  question: z.string().optional(),
  answer: z.string().optional(),
  content: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const POST = withAuth(async (_session, req: Request) => {
  const body = await parseBody(req, improveInputSchema);
  if (!body.ok) return body.response;

  const { kind, question, answer, content, name, description } = body.data;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Eres un corrector ortográfico y redactor comercial experto para bases de conocimiento y catálogos de productos de agentes IA. Tu única tarea es corregir errores ortográficos, mejorar la gramática, la fluidez y el tono profesional del texto proporcionado, SIN alterar precios, códigos SKU, nombres propios establecidos, horarios, datos ni el sentido original. Normaliza los espacios, elimina saltos de línea innecesarios reemplazándolos por un solo espacio, y devuelve ÚNICAMENTE un objeto JSON que contenga los mismos campos enviados ('question', 'answer', 'content', 'name' o 'description') con el texto corregido y pulido.",
    },
    {
      role: "user",
      content: JSON.stringify({
        kind,
        question: question ?? "",
        answer: answer ?? "",
        content: content ?? "",
        name: name ?? "",
        description: description ?? "",
      }),
    },
  ];

  const result = await chatJson(improveOutputSchema, messages);
  if (!result.ok) {
    return apiError(500, "internal", `No se pudo procesar la mejora con IA: ${result.detail}`);
  }

  return Response.json({ improved: result.data });
});
