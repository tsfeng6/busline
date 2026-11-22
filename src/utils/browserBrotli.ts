import { CITY_BVPK_BLOCK_LIMIT } from './cityBvpk';

let initializing: Promise<typeof import('brotli-dec-wasm/web')> | undefined;

function loadBrotli() {
  initializing ??= Promise.all([
    import('brotli-dec-wasm/web'),
    import('brotli-dec-wasm/web/bg.wasm?url'),
  ]).then(async ([brotli, asset]) => {
    await brotli.default({ module_or_path: asset.default });
    return brotli;
  }).catch(error => {
    initializing = undefined;
    throw error;
  });
  return initializing;
}

/** Bundled and loaded only for BVPK1, including on browsers without native Brotli streams. */
export async function decodeBrowserBrotli(input: Uint8Array) {
  const brotli = await loadBrotli();
  const stream = new brotli.DecompressStream();
  const chunks: Uint8Array[] = [];
  let consumed = 0, size = 0;
  try {
    for (;;) {
      const result = stream.decompress(input.subarray(consumed), 64 * 1024);
      try {
        const chunk = result.buf;
        consumed += result.input_offset;
        size += chunk.byteLength;
        if (size > CITY_BVPK_BLOCK_LIMIT) throw Error('BVPK1: 解压分片过大。');
        chunks.push(chunk);
        if (result.code === brotli.BrotliStreamResultCode.ResultSuccess && consumed === input.length) break;
        if (result.code !== brotli.BrotliStreamResultCode.NeedsMoreOutput || !chunk.byteLength) {
          throw Error('BVPK1: Brotli 数据不完整。');
        }
      } finally { result.free(); }
    }
  } finally { stream.free(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
