import OpenAI from 'openai';
import { config } from '../config.js';

export function createLlmClient(): OpenAI {
  return new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
}
