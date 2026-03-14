/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { AiResponse, DebugInfo, GestureAnalysis } from "../types";

let ai: GoogleGenAI | null = null;

if (process.env.API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} else {
  console.error("API_KEY is missing from environment variables.");
}

const MODEL_NAME = "gemini-3-flash-preview";

export const recognizeLetter = async (
  imageBase64: string,
  targetLetter: string,
  gestureAnalysis?: GestureAnalysis | null
): Promise<AiResponse> => {
  const startTime = performance.now();

  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: `Target Letter: ${targetLetter}${gestureAnalysis ? ` | Gesture Analysis: ${JSON.stringify(gestureAnalysis)}` : ""}`,
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  if (!ai) {
    return {
      result: { letter: "", confidence: 0, message: "API Key missing." },
      debug: { ...debug, error: "API Key Missing" }
    };
  }

  const gestureSummary = gestureAnalysis
    ? JSON.stringify(gestureAnalysis, null, 2)
    : "MediaPipe finger analysis unavailable.";

  const prompt = `
    You are an expert in Turkish Sign Language finger spelling.
    The user is trying to sign this target letter: "${targetLetter}".

    You will receive:
    1. The camera image.
    2. MediaPipe-derived hand analysis with hand count, finger open/closed states, pinch strength, and hand proximity.

    Treat the MediaPipe hand analysis as an important signal, especially for finger-state reasoning.

    MediaPipe hand analysis:
    ${gestureSummary}

    Decision rules:
    - Focus on finger states first: thumb, index, middle, ring, pinky.
    - For two-handed signs, use whether both hands are visible, how close they are, and which fingers are extended.
    - For letters with diacritics such as Ö and Ü, be tolerant.
    - If the base handshape strongly looks like O/U and the second hand seems to be adding the two-dot modifier approximately, you may return Ö/Ü with high confidence.
    - Do not require a perfect two-dot pose for Ö/Ü. A reasonable two-handed approximation should still be accepted.
    - If the gesture is close to the target letter, prefer the target letter over a strict but brittle interpretation.

    Return only raw JSON with this shape:
    {
      "letter": "LETTER",
      "confidence": 0.0,
      "message": "Short feedback"
    }
  `;

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/png",
              data: cleanBase64
            }
          }
        ]
      },
      config: {
        maxOutputTokens: 512,
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    });

    debug.latency = Math.round(performance.now() - startTime);

    let text = response.text || "{}";
    debug.rawResponse = text;

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }

    try {
      const json = JSON.parse(text);
      debug.parsedResponse = json;

      return {
        result: {
          letter: (json.letter || "").toUpperCase(),
          confidence: Number(json.confidence) || 0,
          message: json.message
        },
        debug
      };
    } catch (e: any) {
      return {
        result: { letter: "", confidence: 0, message: "Parse error" },
        debug: { ...debug, error: `JSON Parse Error: ${e.message}` }
      };
    }
  } catch (error: any) {
    debug.latency = Math.round(performance.now() - startTime);
    return {
      result: { letter: "", confidence: 0, message: "API Error" },
      debug: { ...debug, error: error.message || "Unknown API Error" }
    };
  }
};
