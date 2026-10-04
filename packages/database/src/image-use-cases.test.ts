import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_PENDING_MS,
  ImageNotFoundError,
  StorageFullError,
  ImageRejectedError,
  InvalidProcedureReferenceError,
  NotAuthorizedError,
  WorkspaceNotFoundError,
  addMember,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  imageUsage,
  listWorkspaceStorage,
  purgeUnusedImages,
  readStepImage,
  setWorkspaceStorageCeiling,
  startRun,
  updateProcedure,
  uploadStepImage,
  type ImageDeps,
  type ImageProcessor,
  type ProcedureInput,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ProcedureId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createFileMediaStore, mediaPath } from '@vergissmeinnicht/media';
import { createImageRepository } from './image-repository.ts';
import { createStorageRepository } from './storage-usage.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

/** Stands in for sharp: "processes" to the same bytes (sizes are chosen by the test); `bad…` is refused. */
const fakeProcessor: ImageProcessor = {
  async process(input) {
    if (new TextDecoder().decode(input.subarray(0, 3)) === 'bad') throw new ImageRejectedError('unsupported_format');
    return { jpeg: input, width: 800, height: 600 };
  },
};
let counter = 0;
/** Distinct content of `bytes` size (distinct SHA-256). */
const image = (bytes: number) => {
  const data = new Uint8Array(bytes);
  new DataView(data.buffer).setUint32(0, ++counter);
  data[bytes - 1] = counter % 251;
  return data;
};
const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;

describe('instruction images (14.3)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let mediaRoot: string;
  let now: Date;
  let deps: ImageDeps;
  let admin: User;
  let eddie: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  const clock = { now: () => now };
  let storage: { storage: ReturnType<typeof createStorageRepository>; clock: typeof clock };
  const procedureDeps = () => ({ workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock });
  const runDeps = () => ({ workspaces: deps.workspaces, runs: createRunRepository(database), clock });
  const content = (imageId: string | null, caption = 'Blue lever left of the meter'): ProcedureInput => ({
    title: 'Leave the house',
    description: '',
    icon: 'home',
    tags: [],
    sections: [{ title: 'Utilities', description: '', steps: [{ ...STEP, title: 'Close the main water valve', image: imageId === null ? null : { id: imageId, caption } }] }],
  });
  const upload = (bytes: number, actor = eddie, workspace = home, replacing?: string) =>
    uploadStepImage(deps, { actor, workspaceId: workspace.id, bytes: image(bytes), ...(replacing === undefined ? {} : { replacing }) });
  /** Fills the Workspace with `total` bytes of pending (just uploaded) images, 500 KB each. */
  const fill = async (total: number) => {
    for (let used = 0; used + 500_000 <= total; used += 500_000) await upload(500_000);
  };

  beforeEach(async () => {
    database = createTestDatabase();
    mediaRoot = mkdtempSync(join(tmpdir(), 'vmn-images-'));
    now = new Date('2026-10-01T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    deps = { workspaces, images: createImageRepository(database), store: createFileMediaStore(mediaRoot), processor: fakeProcessor, clock };
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    eddie = await user('eddie@example.org', 'Eddie');
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    for (const [member, role] of [
      [eddie, 'EDITOR'],
      [uma, 'USER'],
      [gus, 'GUEST'],
    ] as const) {
      await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: member.email, role });
    }
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    // A small ceiling, so that the limit can be reached with test images (the default is 5 GB).
    database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = 100000000').run();
    storage = { storage: createStorageRepository(database), clock };
  });
  afterEach(() => {
    database.dispose();
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('uploads with procedure.edit only, stores the processed file once and serves it inside the Workspace only', async () => {
    const bytes = image(1000);
    const first = await uploadStepImage(deps, { actor: eddie, workspaceId: home.id, bytes });
    const again = await uploadStepImage(deps, { actor: eddie, workspaceId: home.id, bytes });
    expect(again.image.id).toBe(first.image.id); // identical content: one image, charged once
    expect(again.usage.used).toBe(1000);
    expect(await readStepImage(deps, { actor: gus, workspaceId: home.id, imageId: first.image.id })).toEqual(bytes);
    await expect(uploadStepImage(deps, { actor: uma, workspaceId: home.id, bytes })).rejects.toThrow(NotAuthorizedError);
    await expect(uploadStepImage(deps, { actor: gus, workspaceId: home.id, bytes })).rejects.toThrow(NotAuthorizedError);
    await expect(uploadStepImage(deps, { actor: otto, workspaceId: home.id, bytes })).rejects.toThrow(WorkspaceNotFoundError);
    // A known id (or hash) is no key: another Workspace's member gets "not found" under their own Workspace.
    await expect(readStepImage(deps, { actor: otto, workspaceId: office.id, imageId: first.image.id })).rejects.toThrow(ImageNotFoundError);
    await expect(readStepImage(deps, { actor: otto, workspaceId: home.id, imageId: first.image.id })).rejects.toThrow(WorkspaceNotFoundError);
    await expect(uploadStepImage(deps, { actor: eddie, workspaceId: home.id, bytes: new TextEncoder().encode('bad file') })).rejects.toThrow(ImageRejectedError);
  });

  it('puts one image with a required caption on a Step, and refuses images of another Workspace', async () => {
    const { image: valve } = await upload(1000);
    const created = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id) });
    expect(created.sections[0]?.steps[0]?.image).toEqual({ id: valve.id, caption: 'Blue lever left of the meter' });
    await expect(createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id, ' ') })).rejects.toThrow(DomainValidationError);
    const { image: foreign } = await upload(1000, otto, office);
    await expect(createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(foreign.id) })).rejects.toThrow(InvalidProcedureReferenceError);
    await expect(createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f') })).rejects.toThrow(InvalidProcedureReferenceError);
  });

  it('refuses to attach an upload that was left unused past the grace period (no longer charged)', async () => {
    const { image: stale } = await upload(1000);
    now = new Date(now.getTime() + IMAGE_PENDING_MS + 60_000);
    expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(0);
    await expect(createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(stale.id) })).rejects.toThrow(InvalidProcedureReferenceError);
    // Uploading the same photo again charges it again, and then it can be used.
    const again = await uploadStepImage(deps, { actor: eddie, workspaceId: home.id, bytes: await readStepImage(deps, { actor: eddie, workspaceId: home.id, imageId: stale.id }) });
    expect(again.usage.used).toBe(1000);
    await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(again.image.id) });
  });

  it('keeps a Run on the image it started with, after replacing, deleting and housekeeping', async () => {
    const { image: a } = await upload(1000);
    const procedure = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(a.id) });
    const procedureId = procedure.procedure.id as ProcedureId;
    const before = await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId });
    const { image: b } = await upload(1000, eddie, home, a.id);
    const updated = await updateProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId, expectedRevision: procedure.procedure.revision, content: content(b.id) });
    const after = await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId });
    expect(before.sections[0]?.steps[0]?.image?.id).toBe(a.id);
    expect(after.sections[0]?.steps[0]?.image?.id).toBe(b.id);
    expect(updated.sections[0]?.steps[0]?.image?.id).toBe(b.id);
    await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId });
    now = new Date(now.getTime() + IMAGE_PENDING_MS * 3);
    expect(await purgeUnusedImages(deps)).toEqual({ files: 0 });
    // A (Run snapshot) and B (Run + restorable deleted Procedure) are still served.
    expect((await readStepImage(deps, { actor: gus, workspaceId: home.id, imageId: a.id })).byteLength).toBe(1000);
    expect((await readStepImage(deps, { actor: gus, workspaceId: home.id, imageId: b.id })).byteLength).toBe(1000);
    // The database itself refuses to delete a referenced image and to change a snapshot.
    expect(() => database.sqlite.prepare('DELETE FROM step_images WHERE id = ?').run(a.id)).toThrow(/FOREIGN KEY/);
    expect(() => database.sqlite.prepare('UPDATE run_steps SET image_id = ? WHERE image_id = ?').run(b.id, a.id)).toThrow(/immutable/);
    expect(() => database.sqlite.prepare("UPDATE step_images SET bytes = 1 WHERE id = ?").run(a.id)).toThrow(/immutable/);
  });

  it('removes unreferenced images and orphan files only after the grace period', async () => {
    const { image: unused } = await upload(1000);
    const { image: used } = await upload(1000);
    await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(used.id) });
    const orphan = await deps.store.put(image(10));
    expect(await purgeUnusedImages(deps)).toEqual({ files: 0 }); // too recent
    now = new Date(now.getTime() + IMAGE_PENDING_MS + 60_000);
    const old = new Date(now.getTime() - IMAGE_PENDING_MS - 1000);
    utimesSync(mediaPath(mediaRoot, orphan), old, old);
    expect(await purgeUnusedImages(deps)).toEqual({ files: 2 }); // the unused upload and the orphan
    await expect(readStepImage(deps, { actor: gus, workspaceId: home.id, imageId: unused.id })).rejects.toThrow(ImageNotFoundError);
    expect((await readStepImage(deps, { actor: gus, workspaceId: home.id, imageId: used.id })).byteLength).toBe(1000);
    expect(await deps.store.read(orphan)).toBeUndefined();
  });

  describe('Workspace storage limit (16.4; D11a until then)', () => {
    it('refuses an upload that would exceed the quota; existing images stay available', async () => {
      await fill(99_500_000);
      await upload(300_000); // 99.8 MB
      await expect(upload(400_000)).rejects.toThrow(StorageFullError);
      try {
        await upload(400_000);
      } catch (error) {
        expect((error as StorageFullError).usage).toMatchObject({ used: 99_800_000, images: 99_800_000, limit: 100_000_000 });
      }
      expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(99_800_000);
    }, 60_000);

    it('lets exactly one of two concurrent uploads through when only one fits', async () => {
      await fill(99_500_000);
      const results = await Promise.allSettled([upload(400_000), upload(400_000)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(99_900_000);
    }, 60_000);

    it('charges an image shared by a template and many Runs once', async () => {
      const { image: valve } = await upload(1000);
      const procedure = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id) });
      for (let i = 0; i < 30; i++) await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: procedure.procedure.id as ProcedureId });
      now = new Date(now.getTime() + IMAGE_PENDING_MS * 2);
      expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(1000);
    });

    it('never deletes when lowered, and blocks storage until usage is below the quota', async () => {
      await setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 250_000_000 });
      await fill(180_000_000);
      await setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 100_000_000 });
      expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(180_000_000);
      await expect(upload(1000)).rejects.toThrow(StorageFullError);
      await expect(setWorkspaceStorageCeiling(storage, { actor: eddie, workspaceId: home.id, bytes: 1_000_000_000 })).rejects.toThrow(NotAuthorizedError);
      await expect(setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 123 })).rejects.toThrow(DomainValidationError);
      const listed = await listWorkspaceStorage(storage, { actor: admin });
      expect(listed.find((entry) => entry.workspaceId === home.id)?.usage).toMatchObject({ used: 180_000_000, images: 180_000_000, limit: 100_000_000, ceiling: 100_000_000 });
      const events = database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'WORKSPACE_STORAGE_CEILING_CHANGED' ORDER BY rowid").all() as { metadata: string }[];
      expect(events.map((row) => JSON.parse(row.metadata))).toEqual([
        { from: 100_000_000, to: 250_000_000 },
        { from: 250_000_000, to: 100_000_000 },
      ]);
    }, 120_000);

    it('replaces an image at the limit when the old one is used only by its Step; old Runs keep theirs charged', async () => {
      const { image: old } = await upload(400_000);
      const procedure = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(old.id) });
      now = new Date(now.getTime() + IMAGE_PENDING_MS * 2);
      await fill(99_500_000);
      // 99.9 MB used: a 400 KB replacement fits only because the old image is released by it.
      await expect(upload(400_000)).rejects.toThrow(StorageFullError);
      const { image: replacement } = await upload(400_000, eddie, home, old.id);
      await updateProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: procedure.procedure.id as ProcedureId, expectedRevision: procedure.procedure.revision, content: content(replacement.id) });
      // With a Run on the old image, removing it from the Step does not free its bytes.
      await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: procedure.procedure.id as ProcedureId });
      const withRun = (await imageUsage(deps, { actor: gus, workspaceId: home.id })).used;
      await updateProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: procedure.procedure.id as ProcedureId, expectedRevision: procedure.procedure.revision + 1, content: content(null) });
      expect((await imageUsage(deps, { actor: gus, workspaceId: home.id })).used).toBe(withRun);
    }, 60_000);
  });

  it('keeps image and caption together in the database', async () => {
    const { image: valve } = await upload(1000);
    const procedure = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id) });
    expect(() => database.sqlite.prepare('UPDATE procedure_steps SET image_caption = NULL WHERE procedure_id = ?').run(procedure.procedure.id)).toThrow(/caption/);
    expect(() => database.sqlite.prepare("UPDATE procedure_steps SET image_caption = '' WHERE procedure_id = ?").run(procedure.procedure.id)).toThrow(/caption/);
    expect(() => database.sqlite.prepare('UPDATE procedure_steps SET image_id = NULL WHERE procedure_id = ?').run(procedure.procedure.id)).toThrow(/caption/);
  });
});
