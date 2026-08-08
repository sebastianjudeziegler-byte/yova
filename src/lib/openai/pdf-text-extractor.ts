import "server-only";

import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAISessionConfig } from "@/lib/openai/config";

const MAX_EXTRACTED_CHARACTERS = 50_000;

export async function extractScannedPdfTextWithOpenAI(bytes: Uint8Array, filename: string) {
  const config = getOpenAISessionConfig();
  if (!config) return null;

  const client = getOpenAIClient();
  const fileData = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  const response = await client.responses.create({
    model: config.model,
    instructions: [
      "Extract the readable educational text from this PDF accurately.",
      "Preserve headings, dates, names, terms, questions, and answer choices in reading order.",
      "Do not summarize, answer the study guide, add outside knowledge, or describe the document.",
      "Return only the extracted text. If the pages contain no readable learning content, return exactly NO_READABLE_TEXT.",
    ].join(" "),
    input: [{
      role: "user",
      content: [
        {
          type: "input_file",
          filename: filename.slice(0, 180),
          file_data: fileData,
          detail: "low",
        },
        {
          type: "input_text",
          text: "Extract the document text for a private study plan.",
        },
      ],
    }],
    reasoning: { effort: "low" },
    max_output_tokens: 8_000,
    store: false,
  }, {
    maxRetries: 0,
    timeout: 30_000,
  });

  const text = response.output_text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || text === "NO_READABLE_TEXT") return null;

  return {
    text: text.slice(0, MAX_EXTRACTED_CHARACTERS),
    pages: null,
    truncated: text.length > MAX_EXTRACTED_CHARACTERS,
  };
}
