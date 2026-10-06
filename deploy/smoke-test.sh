#!/bin/sh
# Starts a built image with a throwaway production configuration and checks that every runtime path
# loads: migrate, admin bootstrap CLI, backup, the server becoming ready, and a scheduled backup. Used by CI after the
# image build (the image prunes dev-only packages; this proves nothing needed was removed).
#   deploy/smoke-test.sh <image>
set -eu
image="${1:?usage: smoke-test.sh <image>}"
name="vmn-smoke-$$"
volume="vmn-smoke-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }
set -- \
  -e PUBLIC_ORIGIN=http://127.0.0.1:3000 \
  -e AUTH_SECRET="$(secret)" \
  -e DATA_ENCRYPTION_KEY="$(secret)" \
  -e SMTP_HOST=127.0.0.1 \
  -e SMTP_SECURITY=none \
  -e MAIL_FROM_ADDRESS=noreply@example.org \
  -v "$volume:/data"

docker run --rm "$@" "$image" migrate
docker run --rm "$@" "$image" admin-bootstrap --email admin@example.org | grep -q '/invite/'
docker run --rm "$@" "$image" backup | grep -q 'Backup written and verified'
docker run -d --name "$name" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -e BACKUP_INTERVAL_HOURS=24 "$@" "$image" serve >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
    # The web app and the service worker are served as well.
    docker exec "$name" node -e "Promise.all(['/', '/sw.js', '/manifest.webmanifest', '/third-party-notices.txt'].map((p) => fetch('http://127.0.0.1:3000' + p))).then((rs) => process.exit(rs.every((r) => r.ok) ? 0 : 1), () => process.exit(1))"
    # Instruction images (14.3): sharp/libvips load and process an image in the read-only container,
    # and the server licence notices ship with the image.
    docker exec "$name" node -e "import('/app/packages/media/src/index.ts').then(async (m) => { const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'); const r = await m.createSharpImageProcessor().process(new Uint8Array(png)); process.exit(r.width === 1 && r.jpeg[0] === 0xff ? 0 : 1); }, () => process.exit(1))"
    docker exec "$name" sh -c 'grep -q "@img/sharp-libvips-linux" /app/third-party-notices-server.txt'
    # Document files (16.1): MuPDF (WebAssembly, in a worker thread) reads a PDF in the read-only
    # container; an iPhone HEIC is recognised from its container, staged byte-identical on the data
    # volume and gets no preview (no HEVC decoder is shipped); the notices list MuPDF and no HEVC decoder.
    docker exec "$name" node -e "import('/app/packages/media/src/index.ts').then(async (m) => { const fs = await import('node:fs'); const crypto = await import('node:crypto'); const f = '/app/packages/media/src/fixtures/'; const p = m.createDocumentFileProcessor(); const pdf = await p.inspect(f + 'three-pages.pdf', 3766); const page = await p.renderPage(f + 'three-pages.pdf', 'PDF', 2); const bytes = fs.readFileSync(f + 'photo.heic'); const heic = await p.inspect(f + 'photo.heic', bytes.length); const preview = await p.renderPage(f + 'photo.heic', 'HEIC', 0); const store = m.createDocumentFileStore('/data/documents'); const staged = await store.stage((async function* () { yield bytes; })(), 100000); await staged.commit(); const sha = crypto.createHash('sha256').update(bytes).digest('hex'); const same = Buffer.compare(fs.readFileSync(m.documentFilePath('/data/documents', sha)), bytes) === 0; await store.remove(sha); await p.close(); process.exit(pdf.pageCount === 3 && page.jpeg[0] === 0xff && heic.format === 'HEIC' && heic.width === 320 && preview === undefined && staged.sha256 === sha && same ? 0 : 1); }, () => process.exit(1))"
    docker exec "$name" sh -c 'grep -q "^mupdf@" /app/third-party-notices-server.txt && ! grep -qi "libheif-js\|libde265" /app/third-party-notices-server.txt'
    # Text recognition (16.9): only the one WebAssembly variant ships, the language data and its notice
    # are in the image, and OCR reads a printed word in a read-only container **without any network**.
    docker exec "$name" sh -c 'ls /app/node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/ | grep "^tesseract-core" | tr "\n" " " | grep -qx "tesseract-core-simd-lstm.js tesseract-core-simd-lstm.wasm "'
    docker exec "$name" sh -c 'grep -q "^tesseract.js-core@" /app/third-party-notices-server.txt && grep -q "tessdata_best" /app/third-party-notices-server.txt'
    docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --entrypoint node "$image" -e "import('/app/packages/media/src/index.ts').then(async (m) => { const pdf = m.createDocumentWorker(); const x = m.createTextExtractor({ pdf, tessdataPath: '/app/packages/media/tessdata' }); const text = await x.recognizeImage('/app/packages/media/src/fixtures/printed-text.png'); await x.close(); await pdf.close(); process.exit(/bolletta acqua/i.test(text) ? 0 : 1); }, () => process.exit(1))"
    # The scheduled backup ran at start (BACKUP_INTERVAL_HOURS).
    for _ in $(seq 1 10); do
      docker exec "$name" sh -c 'ls /data/backups | grep -q "^vergissmeinnicht-auto-"' && break
      sleep 1
    done
    docker exec "$name" sh -c 'ls /data/backups | grep -q "^vergissmeinnicht-auto-"'
    echo "smoke test passed: $image"
    exit 0
  fi
  sleep 1
done
docker logs "$name" >&2
echo "server did not become ready" >&2
exit 1
