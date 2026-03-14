/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { AiResponse, DebugInfo, LetterRecognitionResult } from "../types";

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;

if (process.env.API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} else {
    console.error("API_KEY is missing from environment variables.");
}

const MODEL_NAME = "gemini-3-flash-preview";

export const recognizeLetter = async (
  imageBase64: string,
  targetLetter: string
): Promise<AiResponse> => {
  const startTime = performance.now();
  
  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: `Target Letter: ${targetLetter}`,
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  if (!ai) {
    return {
        result: { letter: "", confidence: 0, message: "API Key missing." },
        debug: { ...debug, error: "API Key Missing" }
    };
  }

  const prompt = `
    Sen bir Türk İşaret Dili (TİD) uzmanısın. Sağlanan el hareketi görüntüsünü analiz et.
    Kullanıcı şu harfi işaret etmeye çalışıyor: "${targetLetter}".
    
    Görüntüde bir veya iki el olabilir. Türk İşaret Dili'nde bazı harfler tek elle, bazıları iki elle yapılır. 
    Özellikle parmakların oluşturduğu şekillere odaklan.
    
    KRİTİK TALİMAT: Ü, Ö, İ, Ç, Ş, Ğ gibi noktalı veya ek işaretli harfler iki elle yapıldığında tam olarak yakalamak zor olabilir. 
    Eğer kullanıcı bu harfler için makul bir yakınsama/deneme yapıyorsa (örneğin Ü için U işaretine ek olarak parmaklarını oynatıyorsa veya iki elini yaklaştırıyorsa), bunu kabul et ve yüksek güven puanı ver.
    
    Hangi harfin (A-Z, Ç, Ğ, İ, Ö, Ş, Ü dahil) işaret edildiğini belirle.
    Eğer hedef harfe yakınsa teşvik edici bir mesaj yaz.
    
    Sadece ham JSON döndür. Markdown kullanma. Kod blokları kullanma.
    JSON yapısı:
    {
      "letter": "HARF",
      "confidence": 0.0-1.0,
      "message": "Kısa geri bildirim mesajı"
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

    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    
    let text = response.text || "{}";
    debug.rawResponse = text;
    
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
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
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return {
        result: { letter: "", confidence: 0, message: "API Error" },
        debug: { ...debug, error: error.message || "Unknown API Error" }
    };
  }
};
