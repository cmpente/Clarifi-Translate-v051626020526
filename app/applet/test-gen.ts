import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

async function run() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: 'A simple red apple',
      config: {
        imageConfig: {
          aspectRatio: "3:4",
          imageSize: "1K"
        }
      }
    });
    console.log("Success!");
  } catch (e) {
    console.error(e);
  }
}
run();
