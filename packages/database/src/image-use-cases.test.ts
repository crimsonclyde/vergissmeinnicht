import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_PENDING_MS,
  ImageInUseError,
  ImageNotFoundError,
  StorageFullError,
  ImageRejectedError,
  InvalidProcedureReferenceError,
  NotAuthorizedError,
  ProcedureConflictError,
  getProcedure,
  removeStepImage,
  replaceStepImageEverywhere,
  restoreProcedure,
  WorkspaceNotFoundError,
  addMember,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  GALLERY_PAGE_SIZE,
  imageUsage,
  listImageUses,
  listWorkspaceImages,
  readStepImageThumbnail,
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

  describe('Workspace photo gallery (23.1)', () => {
    const gallery = (actor: User, search?: string, workspace = home) => listWorkspaceImages(deps, { actor, workspaceId: workspace.id, search });

    it('lists the photos a Step may use, newest first, with where they are used, for editors only', async () => {
      const { image: valve } = await upload(1000);
      now = new Date(now.getTime() + 1000);
      const { image: meter } = await upload(1000);
      now = new Date(now.getTime() + 1000);
      const { image: stale } = await upload(1000);
      const first = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id) });
      now = new Date(now.getTime() + 1000);
      await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id, 'Newest caption') });
      await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: first.procedure.id as ProcedureId });
      await upload(1000, otto, office); // another Workspace's photo never shows up
      now = new Date(now.getTime() + IMAGE_PENDING_MS + 60_000); // `stale` and `meter` were never used: no longer attachable
      const page = await gallery(eddie);
      expect(page.images.map((entry) => entry.id)).toEqual([valve.id]);
      expect(page.images[0]).toMatchObject({ steps: 2, procedures: 2, caption: 'Newest caption', bytes: 1000, width: 800, height: 600 });
      expect(page.next).toBeNull();
      expect(JSON.stringify(page)).not.toMatch(/sha|created_by|eddie/i);
      expect([meter.id, stale.id]).not.toContain(page.images[0]?.id);
      // Admins too; USER, GUEST and non-members not.
      expect((await gallery(admin)).images).toHaveLength(1);
      await expect(gallery(uma)).rejects.toThrow(NotAuthorizedError);
      await expect(gallery(gus)).rejects.toThrow(NotAuthorizedError);
      await expect(gallery(otto)).rejects.toThrow(WorkspaceNotFoundError);
      // A deleted Procedure no longer counts as a use; its Run snapshot keeps the photo attachable.
      await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: first.procedure.id as ProcedureId });
      expect((await gallery(eddie)).images[0]).toMatchObject({ steps: 1, procedures: 1 });
      const uses = await listImageUses(deps, { actor: eddie, workspaceId: home.id, imageId: valve.id });
      expect(uses).toEqual([expect.objectContaining({ procedureTitle: 'Leave the house', stepTitle: 'Close the main water valve' })]);
    });

    it('searches captions and Step titles as plain text, and pages through many photos', async () => {
      const { image: valve } = await upload(1000);
      await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id, 'Lever 100% open') });
      expect((await gallery(eddie, 'lever')).images.map((entry) => entry.id)).toEqual([valve.id]);
      expect((await gallery(eddie, 'water valve')).images).toHaveLength(1); // the Step title
      expect((await gallery(eddie, '100%')).images).toHaveLength(1);
      expect((await gallery(eddie, '%')).images).toHaveLength(1);
      expect((await gallery(eddie, '_')).images).toHaveLength(0); // literal, not a wildcard
      expect((await gallery(eddie, 'boiler')).images).toHaveLength(0);
      expect((await gallery(eddie, '   ')).images).toHaveLength(1); // blank: no filter
      for (let i = 0; i < GALLERY_PAGE_SIZE + 2; i += 1) await upload(100);
      const first = await gallery(eddie);
      expect(first.images).toHaveLength(GALLERY_PAGE_SIZE);
      expect(first.next).not.toBeNull();
      const second = await listWorkspaceImages(deps, { actor: eddie, workspaceId: home.id, after: first.next ?? undefined });
      expect(second.images).toHaveLength(3);
      expect(second.next).toBeNull();
      const ids = [...first.images, ...second.images].map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }, 60_000);

    it('filters to the photos no current Step shows (23.5), with search and paging', async () => {
      const unused = (search?: string, after?: Parameters<typeof listWorkspaceImages>[1]['after']) =>
        listWorkspaceImages(deps, { actor: eddie, workspaceId: home.id, search, unused: true, after });
      const { image: shown } = await upload(1000);
      const { image: history } = await upload(1000);
      await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(shown.id) });
      const old = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(history.id, 'Old meter') });
      await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      now = new Date(now.getTime() + 1000);
      const { image: fresh } = await upload(1000);
      await upload(1000, otto, office);
      expect((await unused()).images.map((entry) => entry.id)).toEqual([fresh.id, history.id]);
      expect((await unused('meter')).images.map((entry) => entry.id)).toEqual([history.id]);
      expect((await unused('lever')).images).toEqual([]); // only `shown` has that caption on a current Step
      await expect(listWorkspaceImages(deps, { actor: uma, workspaceId: home.id, unused: true })).rejects.toThrow(NotAuthorizedError);
      await expect(listWorkspaceImages(deps, { actor: otto, workspaceId: home.id, unused: true })).rejects.toThrow(WorkspaceNotFoundError);
      for (let i = 0; i < GALLERY_PAGE_SIZE; i += 1) await upload(100);
      const first = await unused();
      expect(first.images).toHaveLength(GALLERY_PAGE_SIZE);
      const second = await unused(undefined, first.next ?? undefined);
      expect(second.next).toBeNull();
      const ids = [...first.images, ...second.images].map((entry) => entry.id);
      expect(ids).toHaveLength(GALLERY_PAGE_SIZE + 2); // the new ones, `fresh` and `history` (oldest, last)
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.at(-1)).toBe(history.id);
      expect(ids).not.toContain(shown.id);
    }, 60_000);

    it('serves thumbnails with the access rule of the photo itself', async () => {
      const { image: valve } = await upload(1000);
      const small = new Uint8Array([1, 2, 3]);
      const thumbnailing = { ...deps, processor: { ...fakeProcessor, thumbnail: async () => small } };
      expect(await readStepImageThumbnail(thumbnailing, { actor: gus, workspaceId: home.id, imageId: valve.id })).toEqual(small);
      // Without a thumbnail maker the photo itself is served.
      expect((await readStepImageThumbnail(deps, { actor: gus, workspaceId: home.id, imageId: valve.id })).byteLength).toBe(1000);
      await expect(readStepImageThumbnail(thumbnailing, { actor: otto, workspaceId: home.id, imageId: valve.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(readStepImageThumbnail(thumbnailing, { actor: otto, workspaceId: office.id, imageId: valve.id })).rejects.toThrow(ImageNotFoundError);
      await expect(listImageUses(deps, { actor: otto, workspaceId: office.id, imageId: valve.id })).rejects.toThrow(ImageNotFoundError);
      await expect(listImageUses(deps, { actor: gus, workspaceId: home.id, imageId: valve.id })).rejects.toThrow(NotAuthorizedError);
    });
  });

  describe('replace a photo everywhere (23.2)', () => {
    const replace = (actor: User, imageId: string, replacement: string, workspace = home) =>
      replaceStepImageEverywhere(deps, { actor, workspaceId: workspace.id, imageId, replacement });
    const twoSteps = (imageId: string): ProcedureInput => ({
      ...content(imageId),
      title: 'Arrive home',
      sections: [
        {
          title: 'Utilities',
          description: '',
          steps: [
            { ...STEP, title: 'Open the main water valve', image: { id: imageId, caption: 'Valve' } },
            { ...STEP, title: 'Check the valve again', image: { id: imageId, caption: 'Valve, again' } },
          ],
        },
      ],
    });

    it('swaps the photo in every current Procedure, keeps captions, Runs and deleted Procedures, and records it', async () => {
      const { image: old } = await upload(1000);
      const leave = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(old.id) });
      const arrive = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: twoSteps(old.id) });
      const gone = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: { ...content(old.id), title: 'Old checklist' } });
      const run = await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: leave.procedure.id as ProcedureId });
      await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: gone.procedure.id as ProcedureId });
      const { image: fresh } = await upload(1000, eddie, home, old.id);

      expect(await replace(eddie, old.id, fresh.id)).toEqual({ procedures: 2, steps: 3 });

      const load = (id: string) => getProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: id as ProcedureId });
      const leaveAfter = await load(leave.procedure.id);
      const arriveAfter = await load(arrive.procedure.id);
      expect(leaveAfter.sections[0]?.steps[0]?.image).toEqual({ id: fresh.id, caption: 'Blue lever left of the meter' });
      expect(arriveAfter.sections[0]?.steps.map((step) => step.image)).toEqual([
        { id: fresh.id, caption: 'Valve' },
        { id: fresh.id, caption: 'Valve, again' },
      ]);
      expect(leaveAfter.procedure.revision).toBe(leave.procedure.revision + 1);
      expect(arriveAfter.procedure.revision).toBe(arrive.procedure.revision + 1);
      // The started Run and the deleted (restorable) Procedure keep the old photo.
      const snapshot = database.sqlite.prepare('SELECT image_id FROM run_steps WHERE run_id = ?').all(run.run.id) as { image_id: string }[];
      expect(snapshot.map((row) => row.image_id)).toEqual([old.id]);
      const deletedSteps = database.sqlite.prepare('SELECT image_id FROM procedure_steps WHERE procedure_id = ?').all(gone.procedure.id) as { image_id: string }[];
      expect(deletedSteps.map((row) => row.image_id)).toEqual([old.id]);
      // Exactly one audit event per changed Procedure.
      const events = database.sqlite
        .prepare("SELECT subject_id, metadata FROM audit_events WHERE type = 'PROCEDURE_UPDATED' ORDER BY subject_id")
        .all() as { subject_id: string; metadata: string }[];
      expect(events.map((event) => event.subject_id).sort()).toEqual([leave.procedure.id, arrive.procedure.id].sort());
      const arriveEvent = JSON.parse(events.find((event) => event.subject_id === arrive.procedure.id)?.metadata ?? '{}') as Record<string, unknown>;
      expect(arriveEvent).toMatchObject({ fields: ['structure'], revision: arrive.procedure.revision + 1, stepsChanged: 2, photoReplaced: 2 });
      // An editor still holding the old revision gets the usual conflict.
      await expect(
        updateProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: leave.procedure.id as ProcedureId, expectedRevision: leave.procedure.revision, content: content(old.id) }),
      ).rejects.toThrow(ProcedureConflictError);
      // Replacing with the same photo changes nothing.
      expect(await replace(eddie, fresh.id, fresh.id)).toEqual({ procedures: 0, steps: 0 });
      expect((await load(leave.procedure.id)).procedure.revision).toBe(leave.procedure.revision + 1);
    });

    it('is for editors of this Workspace only and refuses photos of another Workspace or past the grace', async () => {
      const { image: old } = await upload(1000);
      const leave = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(old.id) });
      const { image: fresh } = await upload(1000);
      const { image: foreign } = await upload(1000, otto, office);
      await expect(replace(uma, old.id, fresh.id)).rejects.toThrow(NotAuthorizedError);
      await expect(replace(gus, old.id, fresh.id)).rejects.toThrow(NotAuthorizedError);
      await expect(replace(otto, old.id, fresh.id)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(replace(eddie, old.id, foreign.id)).rejects.toThrow(InvalidProcedureReferenceError);
      await expect(replace(eddie, foreign.id, fresh.id)).rejects.toThrow(ImageNotFoundError);
      await expect(replace(otto, old.id, foreign.id, office)).rejects.toThrow(ImageNotFoundError);
      await expect(replace(eddie, old.id, '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).rejects.toThrow(InvalidProcedureReferenceError);
      // An upload left unused past the grace is no longer charged, so it cannot be put on Steps.
      now = new Date(now.getTime() + IMAGE_PENDING_MS + 60_000);
      await expect(replace(eddie, old.id, fresh.id)).rejects.toThrow(InvalidProcedureReferenceError);
      // Nothing was changed by any refused attempt.
      const after = await getProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: leave.procedure.id as ProcedureId });
      expect(after.procedure.revision).toBe(leave.procedure.revision);
      expect(after.sections[0]?.steps[0]?.image?.id).toBe(old.id);
    });

    it('changes everything or nothing', async () => {
      const { image: old } = await upload(1000);
      const leave = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(old.id) });
      await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: twoSteps(old.id) });
      const { image: fresh } = await upload(1000);
      // The second audit event fails: the first Procedure's change must be rolled back too.
      database.sqlite.exec(`CREATE TEMP TRIGGER fail_second AFTER INSERT ON audit_events
        WHEN (SELECT count(*) FROM audit_events WHERE type = 'PROCEDURE_UPDATED') > 1 BEGIN SELECT RAISE(ABORT, 'boom'); END`);
      await expect(replace(eddie, old.id, fresh.id)).rejects.toThrow(/boom/);
      database.sqlite.exec('DROP TRIGGER fail_second');
      const rows = database.sqlite.prepare('SELECT DISTINCT image_id FROM procedure_steps').all() as { image_id: string }[];
      expect(rows.map((row) => row.image_id)).toEqual([old.id]);
      const after = await getProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: leave.procedure.id as ProcedureId });
      expect(after.procedure.revision).toBe(leave.procedure.revision);
    });
  });

  describe('delete a photo from the gallery (23.4)', () => {
    const remove = (actor: User, imageId: string, workspace = home) => removeStepImage(deps, { actor, workspaceId: workspace.id, imageId });
    const galleryIds = async () => (await listWorkspaceImages(deps, { actor: eddie, workspaceId: home.id })).images.map((photo) => photo.id);
    const removals = () => database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type = 'STEP_IMAGE_REMOVED' ORDER BY rowid").all() as { metadata: string }[];

    it('refuses a photo a current Step shows, deletes an unused one and only hides one that history still shows', async () => {
      const { image: shown } = await upload(1000);
      const { image: loose } = await upload(1000);
      const { image: history } = await upload(1000);
      await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(shown.id) });
      const old = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: { ...content(history.id), title: 'Old checklist' } });
      const run = await startRun(runDeps(), { actor: uma, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      const before = await imageUsage(deps, { actor: eddie, workspaceId: home.id });

      await expect(remove(eddie, shown.id)).rejects.toThrow(ImageInUseError);
      expect(await remove(eddie, loose.id)).toEqual({ kept: false });
      expect(await remove(eddie, history.id)).toEqual({ kept: true });

      expect(await galleryIds()).toEqual([shown.id]);
      // The unused photo is gone and no longer charged; the other one stays for its Run and the deleted Procedure.
      expect(database.sqlite.prepare('SELECT id FROM step_images WHERE id = ?').get(loose.id)).toBeUndefined();
      expect((await imageUsage(deps, { actor: eddie, workspaceId: home.id })).used).toBe(before.used - 1000);
      const snapshot = database.sqlite.prepare('SELECT image_id FROM run_steps WHERE run_id = ?').all(run.run.id) as { image_id: string }[];
      expect(snapshot.map((row) => row.image_id)).toEqual([history.id]);
      expect(await readStepImage(deps, { actor: uma, workspaceId: home.id, imageId: history.id })).toHaveLength(1000);
      expect(removals().map((row) => JSON.parse(row.metadata) as unknown)).toEqual([
        { image: loose.id, kept: false },
        { image: history.id, kept: true },
      ]);
      // Restoring the Procedure shows the photo on a current Step again, so the gallery lists it again.
      await restoreProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      expect((await galleryIds()).sort()).toEqual([shown.id, history.id].sort());
      // A deleted photo is unknown afterwards.
      await expect(remove(eddie, loose.id)).rejects.toThrow(ImageNotFoundError);
    });

    it('is for editors of this Workspace only and changes nothing when refused', async () => {
      const { image: loose } = await upload(1000);
      const { image: foreign } = await upload(1000, otto, office);
      await expect(remove(uma, loose.id)).rejects.toThrow(NotAuthorizedError);
      await expect(remove(gus, loose.id)).rejects.toThrow(NotAuthorizedError);
      await expect(remove(otto, loose.id)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(remove(eddie, foreign.id)).rejects.toThrow(ImageNotFoundError);
      await expect(remove(otto, loose.id, office)).rejects.toThrow(ImageNotFoundError);
      await expect(remove(eddie, '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).rejects.toThrow(ImageNotFoundError);
      await expect(remove(eddie, 'not-an-id')).rejects.toThrow(DomainValidationError);
      expect(await galleryIds()).toEqual([loose.id]);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM step_images').get()).toEqual({ n: 2 });
      expect(removals()).toEqual([]);
    });

    it('deletes and records together, or neither', async () => {
      const { image: loose } = await upload(1000);
      database.sqlite.exec("CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.type = 'STEP_IMAGE_REMOVED' BEGIN SELECT RAISE(ABORT, 'boom'); END");
      await expect(remove(eddie, loose.id)).rejects.toThrow(/boom/);
      database.sqlite.exec('DROP TRIGGER fail_audit');
      expect(await galleryIds()).toEqual([loose.id]);
    });

    it('lets housekeeping delete a hidden photo once nothing shows it, mark included', async () => {
      const { image: history } = await upload(1000);
      const old = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(history.id) });
      await deleteProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, procedureId: old.procedure.id as ProcedureId });
      expect(await remove(eddie, history.id)).toEqual({ kept: true });
      // The deleted Procedure goes for good (as a purge would): nothing references the photo any more.
      database.sqlite.prepare('DELETE FROM procedure_steps WHERE procedure_id = ?').run(old.procedure.id);
      now = new Date(now.getTime() + IMAGE_PENDING_MS + 60_000);
      await purgeUnusedImages(deps);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM step_image_removals').get()).toEqual({ n: 0 });
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM step_images').get()).toEqual({ n: 0 });
    });
  });

  it('keeps image and caption together in the database', async () => {
    const { image: valve } = await upload(1000);
    const procedure = await createProcedure(procedureDeps(), { actor: eddie, workspaceId: home.id, content: content(valve.id) });
    expect(() => database.sqlite.prepare('UPDATE procedure_steps SET image_caption = NULL WHERE procedure_id = ?').run(procedure.procedure.id)).toThrow(/caption/);
    expect(() => database.sqlite.prepare("UPDATE procedure_steps SET image_caption = '' WHERE procedure_id = ?").run(procedure.procedure.id)).toThrow(/caption/);
    expect(() => database.sqlite.prepare('UPDATE procedure_steps SET image_id = NULL WHERE procedure_id = ?').run(procedure.procedure.id)).toThrow(/caption/);
  });
});
