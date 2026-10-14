import { MAX_ID_CHARS, MAX_FINAL_TEXT_CHARS } from '../../../services/chatgpt-bridge/config.mjs';
const RECEIPT_FIELDS = ['conversationId', 'userMessageId', 'turnId']; // Native identity tuple, never inferred from time or a reused request ID.
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
export function acceptedReceipt(binding, receipt) {
  if (!receipt || receipt.conversationId !== binding.conversationId || RECEIPT_FIELDS.some(key => !opaque(receipt[key]))) return null;
  return Object.fromEntries(RECEIPT_FIELDS.map(key => [key, receipt[key]]));
}
export function publicReply(binding, receipt, answer) {
  if (!acceptedReceipt(binding, answer) || !receipt || RECEIPT_FIELDS.some(key => answer[key] !== receipt[key]) ||
      !opaque(answer.assistantMessageId) || answer.role !== 'assistant' || answer.channel !== 'final' ||
      typeof answer.text !== 'string' ||
      !answer.text.trim() || answer.text.length > MAX_FINAL_TEXT_CHARS) return null;
  return { ...acceptedReceipt(binding, answer), assistantMessageId: answer.assistantMessageId, text: answer.text };
}
export function completedReceipt(binding, receipt, answer) {
  return answer?.end_turn === true && answer.status === 'finished_successfully' ? publicReply(binding, receipt, answer) : null;
}
