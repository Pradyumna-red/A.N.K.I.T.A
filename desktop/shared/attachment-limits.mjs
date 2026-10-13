export const ATTACHMENT_TEXT_LIMIT = 200_000; // UTF-8 bytes/plain text; existing desktop composer contract.
export const ATTACHMENT_DOC_LIMIT = 1_000_000; // UTF-8 bytes/extracted document; original binaries are never treated as extracted text.
export const ATTACHMENT_IMAGE_LIMIT = 10 * 1024 * 1024; // Decoded bytes/image; shared by API and browser delivery.
export const IMAGE_MIME = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' });
export const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.jsonc', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.cs', '.c', '.h', '.cpp', '.hpp', '.css', '.scss', '.html', '.htm', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env', '.sh', '.bash', '.ps1', '.sql', '.csv', '.tsv', '.log']); // Existing desktop-supported text extensions.
