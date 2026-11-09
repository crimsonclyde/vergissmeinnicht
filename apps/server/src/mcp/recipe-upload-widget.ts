import { MCP_IMAGE_BYTES } from './recipe-upload.ts';

export const recipeUploadWidgetUri = 'ui://vergissmeinnicht/recipe-image-upload.html';
export const recipeUploadWidget = {
  uri: recipeUploadWidgetUri,
  name: 'VMN recipe photo upload',
  mimeType: 'text/html;profile=mcp-app',
};

export const recipeUploadWidgetHtml = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 1rem system-ui; }
main { padding: 1rem; }
label, input, output { display: block; margin-block: .6rem; }
button { min-height: 44px; padding-inline: 1rem; }
output { overflow-wrap: anywhere; }
</style>
<main>
  <form>
    <label for="photo">Choose the downloaded recipe photo (JPEG or PNG)</label>
    <input id="photo" type="file" accept="image/jpeg,image/png" required>
    <button type="submit">Upload original to VMN</button>
  </form>
  <p role="status" id="status"></p>
  <label hidden id="reference-label">VMN image reference
    <input id="reference" readonly>
  </label>
  <button type="button" id="continue" hidden>Continue in ChatGPT</button>
</main>
<script>
const form = document.querySelector('form');
const input = document.querySelector('#photo');
const submit = form.querySelector('button');
const status = document.querySelector('#status');
const reference = document.querySelector('#reference');
const next = document.querySelector('#continue');
let operationId;
let saved;
let destination;
input.addEventListener('change', () => { operationId = undefined; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const host = window.openai;
  const target = host?.toolOutput;
  const file = input.files[0];
  if (!host?.callTool || !target?.workspaceId) {
    status.textContent = 'This client could not open the upload. Use the VMN Recipe editor to upload the file.';
    return;
  }
  if (!file?.size || file.size > ${MCP_IMAGE_BYTES}) {
    status.textContent = 'Choose an image up to 20 MB.';
    return;
  }
  submit.disabled = input.disabled = true;
  status.textContent = 'Uploading original…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    operationId ??= crypto.randomUUID();
    const result = await host.callTool('upload_recipe_image', {
      workspaceId: target.workspaceId, recipeId: target.recipeId,
      operationId, fileName: file.name, imageBase64: dataUrl.slice(dataUrl.indexOf(',') + 1)
    });
    if (result.isError) throw new Error();
    saved = result.structuredContent ?? JSON.parse(result.content?.find(item => item.type === 'text')?.text);
    if (!saved?.attachment?.reference) throw new Error();
    destination = target;
    reference.value = saved.attachment.reference;
    document.querySelector('#reference-label').hidden = false;
    next.hidden = !host.sendFollowUpMessage;
    form.hidden = true;
    status.textContent = 'Original uploaded. The recipe still needs to be saved with this image.';
  } catch {
    status.textContent = 'Upload was not confirmed. Press Upload again to retry the same request.';
    submit.disabled = input.disabled = false;
  }
});
next.addEventListener('click', async () => {
  next.disabled = true;
  try {
    const { workspaceId, recipeId } = destination;
    const target = recipeId ? 'recipe ' + recipeId : 'the new recipe we discussed';
    await window.openai.sendFollowUpMessage({ prompt: 'Use the uploaded image ' + saved.attachment.reference
      + ' for ' + target + ' in VMN Workspace ' + workspaceId + '. Save the recipe and verify the image on read-back.' });
  } catch {
    next.disabled = false;
    status.textContent = 'Continue by copying the image reference into the chat.';
  }
});
</script>`;
