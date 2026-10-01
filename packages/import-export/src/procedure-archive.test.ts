import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readProcedureArchive, writeProcedureArchive } from './procedure-archive.ts';
import { ProcedureImportError, toProcedureDocument } from './procedure-document.ts';

const STEP = { kind: 'CHECK' as const, description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL' as const, notApplicableReasonPolicy: 'OPTIONAL' as const };
const document = toProcedureDocument({
  procedure: { title: 'Leave the house', description: '', icon: 'home', tags: [] },
  sections: [
    {
      id: 's',
      title: 'Utilities',
      description: '',
      steps: [
        { ...STEP, id: 'a', title: 'Close the main water valve', image: null },
        { ...STEP, id: 'b', title: 'Stove off', image: null },
      ],
    },
  ],
} as never);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A hand-made ZIP, to express what a well-behaved writer would never produce. */
function rawZip(entries: { name: string; data: Buffer; mode?: number; deflate?: boolean; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(entry.deflate === true ? 8 : 0, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(entry.deflate === true ? 8 : 0, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const manifest = (images: object[]) =>
  Buffer.from(JSON.stringify({ format: 'vergissmeinnicht.procedure-archive', archiveVersion: 1, document, images }));
const valveImage = { section: 0, step: 0, caption: 'Blue lever', entry: 'images/1.jpg', bytes: jpeg.length, sha256: sha(jpeg) };
const refused = async (archive: Buffer) => {
  try {
    await readProcedureArchive(archive);
    return 'accepted';
  } catch (error) {
    return error instanceof ProcedureImportError ? error.code : `unexpected: ${(error as Error).message}`;
  }
};

describe('Procedure archive (14.3, T4)', () => {
  it('round-trips the document and its images', async () => {
    const archive = await writeProcedureArchive(document, [{ section: 0, step: 0, caption: 'Blue lever', bytes: jpeg }]);
    const read = await readProcedureArchive(archive);
    expect(read.content.title).toBe('Leave the house');
    expect(read.images).toEqual([{ section: 0, step: 0, caption: 'Blue lever', bytes: jpeg }]);
    // Deterministic: no timestamps or other varying data.
    expect(await writeProcedureArchive(document, [{ section: 0, step: 0, caption: 'Blue lever', bytes: jpeg }])).toEqual(archive);
  });

  it('accepts a well-formed hand-made archive', async () => {
    expect(await refused(rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { name: 'images/1.jpg', data: Buffer.from(jpeg) }]))).toBe('accepted');
  });

  it('refuses unsafe or inconsistent archives and writes nothing', async () => {
    const good = { name: 'images/1.jpg', data: Buffer.from(jpeg) };
    const cases: Record<string, Buffer> = {
      traversal: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { ...good, name: '../images/1.jpg' }]),
      absolute: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { ...good, name: '/images/1.jpg' }]),
      backslash: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { ...good, name: 'images\\1.jpg' }]),
      symlink: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { ...good, mode: 0o120777 }]),
      directory: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, good, { name: 'images/', data: Buffer.alloc(0), mode: 0o040755 }]),
      duplicate: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, good, good]),
      unlisted: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, good, { name: 'images/2.jpg', data: Buffer.from(jpeg) }]),
      nonImageEntry: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, good, { name: 'run.sh', data: Buffer.from('#!/bin/sh') }]),
      missingImage: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }]),
      hashMismatch: rawZip([{ name: 'procedure.json', data: manifest([{ ...valveImage, sha256: 'f'.repeat(64) }]) }, good]),
      unknownStep: rawZip([{ name: 'procedure.json', data: manifest([{ ...valveImage, step: 7 }]) }, good]),
      twoImagesOneStep: rawZip([
        { name: 'procedure.json', data: manifest([valveImage, { ...valveImage, entry: 'images/2.jpg' }]) },
        good,
        { name: 'images/2.jpg', data: Buffer.from(jpeg) },
      ]),
      zipBomb: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { name: 'images/1.jpg', data: Buffer.alloc(50_000_000), deflate: true }]),
      highRatio: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { name: 'images/1.jpg', data: Buffer.alloc(5_000_000), deflate: true }]),
      lyingSize: rawZip([{ name: 'procedure.json', data: manifest([valveImage]) }, { name: 'images/1.jpg', data: Buffer.alloc(200_000), deflate: true, declaredSize: 100 }]),
      notZip: Buffer.from('PK but not really'),
      noManifest: rawZip([good]),
      badJson: rawZip([{ name: 'procedure.json', data: Buffer.from('{') }, good]),
      extraField: rawZip([{ name: 'procedure.json', data: Buffer.from(JSON.stringify({ format: 'vergissmeinnicht.procedure-archive', archiveVersion: 1, document, images: [valveImage], owner: 'x' })) }, good]),
    };
    for (const [name, archive] of Object.entries(cases)) expect({ name, result: await refused(archive) }).toEqual({ name, result: 'invalid_archive' });
    const tooMany = rawZip([
      { name: 'procedure.json', data: manifest([]) },
      ...Array.from({ length: 201 }, (_, i) => ({ name: `images/${i + 1}.jpg`, data: Buffer.from(jpeg) })),
    ]);
    expect(await refused(tooMany)).toBe('invalid_archive');
    expect(await refused(Buffer.alloc(125_000_001))).toBe('invalid_archive');
  }, 30_000);

  it('applies the JSON document rules to the embedded document', async () => {
    const archive = rawZip([{ name: 'procedure.json', data: Buffer.from(JSON.stringify({ format: 'vergissmeinnicht.procedure-archive', archiveVersion: 1, document: { format: 'other' }, images: [] })) }]);
    expect(await refused(archive)).toBe('unsupported_format');
  });
});
