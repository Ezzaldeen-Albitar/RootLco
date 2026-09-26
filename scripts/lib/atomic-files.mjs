/**
 * Writes a set of files so that either every one of them changes or none does.
 *
 * WHY THIS EXISTS
 *
 * The run-ledger recorder decides what to write and then writes it. A write
 * that fails half-way — a full disk, a locked file, an interrupted process —
 * must not leave the evidence set in a state no command produced: a ledger
 * that is half a record, or one file updated and its partner not. So a writer
 * computes and validates everything first, then hands the finished bytes here.
 *
 * HOW
 *
 *   1. The current bytes of every target are read, so each can be put back.
 *   2. Every new body is written to a temporary file beside its target. A
 *      failure here removes the temporary files; no target has been touched.
 *   3. Each temporary file is renamed over its target. A rename replaces the
 *      target in one step, so no reader sees a partial file. If a rename fails,
 *      every target already replaced is restored to its original bytes (or
 *      removed, when it did not exist before) and every remaining temporary
 *      file is deleted, and the original error is thrown.
 *
 * The file-system calls are injectable so a test can fail any one of them and
 * check that the tree is byte-identical afterwards. Nothing else is.
 */
import {
  existsSync as realExistsSync,
  readFileSync as realReadFileSync,
  renameSync as realRenameSync,
  unlinkSync as realUnlinkSync,
  writeFileSync as realWriteFileSync,
} from 'node:fs';

const REAL_FS = Object.freeze({
  existsSync: realExistsSync,
  readFileSync: realReadFileSync,
  renameSync: realRenameSync,
  unlinkSync: realUnlinkSync,
  writeFileSync: realWriteFileSync,
});

/**
 * @param {readonly { path: string, content: string }[]} files absolute paths and their new bodies
 * @param {Partial<typeof REAL_FS>} [overrides] file-system calls to use instead of `node:fs`
 */
export function writeFilesAtomically(files, overrides = {}) {
  const fs = { ...REAL_FS, ...overrides };
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('writeFilesAtomically was given the same path twice');
  }

  const originals = files.map((file) =>
    fs.existsSync(file.path) ? fs.readFileSync(file.path) : null
  );
  const suffix = `.tmp-${process.pid}-${Date.now().toString(36)}`;
  const temps = files.map((file) => `${file.path}${suffix}`);

  const discard = (list) => {
    for (const temp of list) {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch {
        // Best effort: a temporary file that cannot be removed is reported by
        // the error the caller already receives, and is never renamed.
      }
    }
  };

  /* Stage every body before touching any target. */
  try {
    files.forEach((file, index) => fs.writeFileSync(temps[index], file.content));
  } catch (error) {
    discard(temps);
    throw error;
  }

  /* Swap them in; on any failure put back what was already swapped. */
  let replaced = 0;
  try {
    for (; replaced < files.length; replaced += 1) {
      fs.renameSync(temps[replaced], files[replaced].path);
    }
  } catch (error) {
    const restoreProblems = [];
    for (let index = 0; index < replaced; index += 1) {
      try {
        if (originals[index] === null) fs.unlinkSync(files[index].path);
        else fs.writeFileSync(files[index].path, originals[index]);
      } catch (restoreError) {
        restoreProblems.push(`${files[index].path}: ${restoreError.message}`);
      }
    }
    discard(temps.slice(replaced));
    if (restoreProblems.length > 0) {
      throw new Error(
        `${error.message}; and restoring the files already replaced failed — ` +
          restoreProblems.join('; ')
      );
    }
    throw error;
  }
}
