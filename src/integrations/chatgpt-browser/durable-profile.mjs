import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PROFILE_BYTES = 16 * 1024 * 1024; // Bytes/journal; shared bound for Send and native-tool receipts.
const locks = new Map(); // Serialized commits per canonical profile file within this owner process.

/** Version validation belongs to the caller. Commit precedes any action grant or receipt acknowledgement. */
export class DurableProfileState {
  constructor({ directory, filename, initial } = {}) {
    if (!path.isAbsolute(directory ?? '') || !filename || path.basename(filename) !== filename || typeof initial !== 'function')
      throw new TypeError('A discovered absolute profile directory and journal filename are required');
    fs.mkdirSync(directory, { recursive: true }); this.directory = fs.realpathSync(directory);
    this.file = path.join(this.directory, filename); this.initial = initial;
  }
  #read() {
    try {
      if (fs.statSync(this.file).size > MAX_PROFILE_BYTES) throw new Error('Profile state exceeds byte limit');
      if (path.dirname(fs.realpathSync(this.file)) !== this.directory) throw new Error('Profile state leaves its owned directory');
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return this.initial(); throw error; }
  }
  #write(state) {
    const text = JSON.stringify(state);
    if (Buffer.byteLength(text) > MAX_PROFILE_BYTES) throw new Error('Profile state exceeds byte limit');
    const temporary = path.join(this.directory, `.${path.basename(this.file)}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.file);
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  run(action, write = false) {
    const task = (locks.get(this.file) ?? Promise.resolve()).catch(() => {}).then(() => {
      const state = this.#read(), result = action(state);
      if (write) this.#write(state);
      return structuredClone(result);
    });
    locks.set(this.file, task);
    return task.finally(() => { if (locks.get(this.file) === task) locks.delete(this.file); });
  }
}
