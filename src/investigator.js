/**
 * Core Ticket Investigator controller
 */

import { SYSTEM_INSTRUCTION, buildUserPrompt } from './prompt.js';
import { fallbackInvestigate } from './rules.js';
import { sanitizeResponse } from './utils.js';

/**
 * Investigates a customer ticket using LLM (Gemini/OpenAI) or local heuristics rule fallback.
 */
export async function investigateTicket(body) {
  const ticketId = body.ticket_id;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Decide LLM provider
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    try {
      const result = await callGeminiAPI(body, geminiKey);
      if (result) {
        return sanitizeResponse(result, ticketId);
      }
    } catch (err) {
      console.error("Gemini API call failed, falling back to heuristics:", err.message);
    }
  }

  if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
    try {
      const result = await callOpenAIAPI(body, openaiKey);
      if (result) {
        return sanitizeResponse(result, ticketId);
      }
    } catch (err) {
      console.error("OpenAI API call failed, falling back to heuristics:", err.message);
    }
  }

  // Fallback to local rule engine if keys are absent or API calls failed
  console.log(`Using heuristics-based fallback engine for ticket: ${ticketId}`);
  return fallbackInvestigate(body);
}

/**
 * Invokes Google Gemini API via native fetch.
 */
async function callGeminiAPI(body, apiKey) {
  // Using gemini-1.5-flash which is standard and fast
  const modelName = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const userPrompt = buildUserPrompt(body);

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1 // Low temperature for deterministic analysis
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const resJson = await response.json();
  const textContent = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textContent) {
    throw new Error("Empty candidate response from Gemini API");
  }

  return JSON.parse(textContent);
}

/**
 * Invokes OpenAI chat completion API via native fetch.
 */
async function callOpenAIAPI(body, apiKey) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const userPrompt = buildUserPrompt(body);

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const resJson = await response.json();
  const textContent = resJson.choices?.[0]?.message?.content;
  if (!textContent) {
    throw new Error("Empty message content from OpenAI API");
  }

  return JSON.parse(textContent);
}
