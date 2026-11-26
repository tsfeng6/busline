let questionKey: Promise<CryptoKey> | undefined;
const key = () => questionKey ??= crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export type SealedQuestion = { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };

export async function sealLocalQuestion<T>(question: T): Promise<SealedQuestion> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = new TextEncoder().encode(JSON.stringify(question));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), value);
  return { iv, ciphertext };
}

export async function openLocalQuestion<T>(question: SealedQuestion): Promise<T> {
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: question.iv }, await key(), question.ciphertext);
  return JSON.parse(new TextDecoder().decode(value));
}
