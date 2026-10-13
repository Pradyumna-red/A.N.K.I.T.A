import path from 'node:path';
import { createHash } from 'node:crypto';
import { ATTACHMENT_DOC_LIMIT, ATTACHMENT_IMAGE_LIMIT, IMAGE_MIME, TEXT_EXTENSIONS } from '../../../desktop/shared/attachment-limits.mjs';
import { MAX_ATTACHMENTS } from '../../../desktop/browser-helper/protocol.mjs';
import { MAX_ID_CHARS } from '../../../services/chatgpt-bridge/config.mjs';

const TEXT_MIME = 'text/plain'; // Extracted document text has its own filename and native text upload type.
const TEXT_SUFFIX = '.txt';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_URL = /^data:(image\/[a-z]+);base64,(.+)$/;
const mimeTypes = new Set([TEXT_MIME, ...Object.values(IMAGE_MIME)]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateBrowserUploads(files = []) {
  if (!Array.isArray(files) || files.length > MAX_ATTACHMENTS || new Set(files.map(file => file?.name)).size !== files.length) throw new Error('Upload names must be unique and within the attachment limit');
  for (const file of files) {
    if (typeof file?.name !== 'string' || !file.name || file.name.length > MAX_ID_CHARS || /[\x00-\x1f/\\]/.test(file.name) ||
        !mimeTypes.has(file.mimeType) || typeof file.data !== 'string' || !BASE64.test(file.data) || !SHA256.test(file.sha256)) throw new Error('Invalid browser upload');
    const bytes = Buffer.from(file.data, 'base64'), limit = file.mimeType === TEXT_MIME ? ATTACHMENT_DOC_LIMIT : ATTACHMENT_IMAGE_LIMIT;
    if (!bytes.length || bytes.length > limit || bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error('Browser upload size or hash changed');
  }
  return files;
}
export function prepareBrowserUploads(normalized = [], { transform = value => value } = {}) {
  const files = [];
  const add = (name, mimeType, bytes) => files.push({ name: name.replace(/[\x00-\x1f/\\]/g, '_').slice(0, MAX_ID_CHARS), mimeType,
    size: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') });
  for (const file of normalized) {
    if (file.text !== undefined) add(TEXT_EXTENSIONS.has(path.extname(file.name).toLowerCase()) ? file.name : file.name + TEXT_SUFFIX,
      TEXT_MIME, Buffer.from(String(transform(file.text)), 'utf8'));
    const images = file.dataUrl ? [file.dataUrl] : file.images ?? [];
    images.forEach((url, index) => {
      const matched = typeof url === 'string' && url.match(IMAGE_URL);
      if (!matched) throw new Error('Unsupported browser attachment image');
      const extension = Object.entries(IMAGE_MIME).find(([, mime]) => mime === matched[1])?.[0];
      if (!extension) throw new Error('Unsupported browser attachment MIME');
      add(file.dataUrl ? file.name : `${file.name}.page-${index + 1}${extension}`, matched[1], Buffer.from(matched[2], 'base64'));
    });
  }
  return validateBrowserUploads(files);
}
export const attachmentMetadata = files => files.map(({ name, mimeType, size, sha256 }) => ({ name, mimeType, size, sha256 }));
export function uploadReceipt(files, observed) {
  return Array.isArray(observed) && observed.length === files.length && files.every((file, index) =>
    ['name', 'mimeType', 'size', 'sha256'].every(key => file[key] === observed[index]?.[key]));
}
