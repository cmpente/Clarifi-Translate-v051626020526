import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

async function run() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: 'A simple red apple',
    });
    console.log("Success!");
  } catch (e) {
    console.error(e);
  }
}
run();
