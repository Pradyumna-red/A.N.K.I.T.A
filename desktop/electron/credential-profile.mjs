import fs from 'node:fs';
import path from 'node:path';
import { CREDENTIAL_STORE_FILENAME } from '../../src/integrations/browser-credentials.mjs';

/** Electron's encryption context follows userData, so its encrypted records must follow the same profile. */
export function desktopCredentialFile({ profileDirectory, legacyDirectory }) {
  const file = path.join(profileDirectory, CREDENTIAL_STORE_FILENAME);
  fs.mkdirSync(profileDirectory, { recursive: true });
  // Preserve the old encrypted file for CLI/other profiles. Never replace an existing profile's records.
  try { fs.copyFileSync(path.join(legacyDirectory, CREDENTIAL_STORE_FILENAME), file, fs.constants.COPYFILE_EXCL); }
  catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  return file;
}
