import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import type { OfflineQuestion } from '../../src/utils/offlineGame';
import type { RankedPuzzle } from '../../src/utils/rankedGame';

type PreparedQuestion = { question: OfflineQuestion; drawing: RankedPuzzle['drawing'] };
const maxDecodedBytes = 32 * 1024 * 1024;
export const QUESTION_TICKET_LIMIT = 8 * 1024 * 1024;

const keyFor = (secret: string) => createHmac('sha256', secret).update('busline-ranked-puzzle-v1').digest();
const context = (run: string, number: number) => Buffer.from(run + ':' + number);

export function sealQuestion(item: PreparedQuestion, secret: string, run: string, number: number): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), nonce);
  cipher.setAAD(context(run, number));
  const payload = Buffer.from(JSON.stringify(item));
  if (payload.length > maxDecodedBytes) throw Error('题面过大。');
  const compressed = brotliCompressSync(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 3 } });
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const ticket = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (ticket.length > QUESTION_TICKET_LIMIT - 64) throw Error('题面过大。');
  return ticket;
}

export function openQuestion(ticket: string, secret: string, run: string, number: number): PreparedQuestion {
  if (ticket.length > QUESTION_TICKET_LIMIT || !/^[\w-]+$/.test(ticket)) throw Error('题包无效。');
  const data = Buffer.from(ticket, 'base64url');
  if (data.length <= 28) throw Error('题包无效。');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), data.subarray(0, 12));
  decipher.setAAD(context(run, number));
  decipher.setAuthTag(data.subarray(12, 28));
  const compressed = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
  return JSON.parse(brotliDecompressSync(compressed, { maxOutputLength: maxDecodedBytes }).toString('utf8'));
}
