export type ToolAction = 'PDF_TO_JPG' | 'JPG_TO_PDF' | 'COMPRESS_PDF' | 'MERGE_PDF' | 'EDIT_PDF' | 'UNKNOWN';

export interface ToolIntent {
  action: ToolAction;
  confidence: number;
  explanation: string;
}

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function detectIntent(prompt: string): Promise<ToolIntent> {
  if (!process.env.GEMINI_API_KEY) {
    return { action: 'UNKNOWN', confidence: 0, explanation: "API Key missing" };
  }

  const systemInstruction = `
    You are a PDF tool intent detector. 
    Analyze the user's request and identify which PDF operation they want to perform.
    Available actions:
    - PDF_TO_JPG: Convert PDF files to image format (JPG/PNG).
    - JPG_TO_PDF: Convert images to PDF format.
    - COMPRESS_PDF: Reduce the file size of a PDF.
    - MERGE_PDF: Combine multiple PDF files into one.
    - EDIT_PDF: Add images, edit layout, or flatten a PDF.
    - UNKNOWN: If the request is unclear.

    Return ONLY a JSON object: { "action": "TOOL_NAME", "confidence": 0.0-1.0, "explanation": "Brief reason" }
  `;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${systemInstruction}\n\nUser request: ${prompt}`,
    });
    
    const text = result.text || "";
    const jsonMatch = text.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Gemini Intent Detection Error:", error);
  }

  return { action: 'UNKNOWN', confidence: 0, explanation: "Failed to parse" };
}
