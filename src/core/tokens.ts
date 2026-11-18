import { Tiktoken } from 'js-tiktoken/lite'
import o200k_base from 'js-tiktoken/ranks/o200k_base'

/**
 * Token counts use OpenAI's o200k_base encoding. Claude and Gemini tokenize differently, but the numbers are
 * close enough to judge whether a prompt fits a context window.
 */
let encoder: Tiktoken | null = null

export function countTokens(text: string): number {
  if (!text) return 0
  encoder ??= new Tiktoken(o200k_base)
  // No special tokens: text like "<|endoftext|>" in a file is counted as plain text instead of throwing.
  return encoder.encode(text, [], []).length
}
