// Fetches the OCR language data (steps.md 16.9, HT9): English, German and Italian from
// tesseract-ocr/tessdata_best (Apache-2.0), pinned to one commit and verified by SHA-256 — a file that
// does not match is not kept. Run by the Docker build, CI and developers (`pnpm ocr:data`); the data is
// never downloaded by the running server.
//
//   node packages/media/scripts/fetch-tessdata.ts [target directory]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TESSDATA_COMMIT = 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec';
export const TESSDATA_FILES: Readonly<Record<string, string>> = {
  eng: '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba',
  deu: '8407331d6aa0229dc927685c01a7938fc5a641d1a9524f74838cdac599f0d06e',
  ita: '8df9c89176fb93f56bf4b2d4ede04c01c1f31d4b7697fbd76cc336df700f3f38',
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const target = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'tessdata'));
mkdirSync(target, { recursive: true });
for (const [language, expected] of Object.entries(TESSDATA_FILES)) {
  const path = join(target, `${language}.traineddata`);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) continue;
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/${TESSDATA_COMMIT}/${language}.traineddata`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${language}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`${language}: SHA-256 ${actual} does not match ${expected}`);
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
  console.log(`${language}.traineddata ${bytes.byteLength} bytes, verified`);
}
writeFileSync(
  join(target, 'NOTICE.txt'),
  `tessdata_best ${TESSDATA_COMMIT} (eng, deu, ita) — https://github.com/tesseract-ocr/tessdata_best\n` +
    'OCR language data of the Tesseract project. Licensed under the Apache License, Version 2.0:\n' +
    'https://www.apache.org/licenses/LICENSE-2.0\n' +
    Object.entries(TESSDATA_FILES).map(([language, hash]) => `${language}.traineddata sha256 ${hash}\n`).join(''),
);
console.log(`OCR language data in ${target}`);
