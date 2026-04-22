import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function getHealthAssessment(metrics: any) {
  try {
    const prompt = `
      You are a specialized server health analyst. Analyze the following storage server metrics and provide a concise (max 3 sentences) health summary in Portuguese (Brazilian).
      Metrics:
      - CPU Load: ${metrics.cpu}%
      - Memory Usage: ${metrics.ram}%
      - Disk Used: ${metrics.diskUsed}%
      - Disk Free: ${metrics.diskFree} GB
      - Deduplication Ratio: ${metrics.dedup}%
      
      Identify any potential risks or confirm if everything looks healthy.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return "Não foi possível gerar a análise inteligente no momento.";
  }
}
