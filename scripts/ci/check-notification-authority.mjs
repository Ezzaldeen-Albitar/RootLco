/**
 * One notification authority, enforced.
 *
 * A second toast stack is not a build failure and not a test failure — it is two
 * components each correct about their own state and both wrong about the user's,
 * and it is discovered by a person wondering why their confirmation appeared in
 * the wrong corner. The gallery shipped exactly that: its own `useState` list and
 * its own `ToastRegion`, beside the real one.
 *
 * Four rules:
 *   1. `ToastRegion` is rendered in exactly ONE place.
 *   2. That place is the notification host.
 *   3. The host is mounted exactly ONCE, in the locale layout.
 *   4. No second notification library is installed.
 *
 * Rule 4 exists because "do not add SweetAlert2 for ordinary notifications" is a
 * decision that decays the moment somebody needs a toast in a hurry.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const WEB_SRC = join(process.cwd(), 'apps', 'web', 'src');
const HOST = join(WEB_SRC, 'components', 'notifications', 'NotificationHost.tsx');
const LAYOUT = join(WEB_SRC, 'app', '[locale]', 'layout.tsx');

const FORBIDDEN_PACKAGES = [
  'sweetalert2',
  'react-toastify',
  'react-hot-toast',
  'sonner',
  'notistack',
  'react-notifications',
];

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Renders of `<ToastRegion`, ignoring comments.
 *
 * The comment strip is what stops this passing on a file that only MENTIONS the
 * component — this codebase explains its decisions in prose, and prose that
 * names a component is not a second mount.
 * @param {string} source
 * @returns {number}
 */
export function toastRegionMounts(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
  return (code.match(/<ToastRegion[\s/>]/g) ?? []).length;
}

/** @param {string} source @returns {number} */
export function hostMounts(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
  return (code.match(/<NotificationHost[\s/>]/g) ?? []).length;
}

function main() {
  /** @type {string[]} */
  const failures = [];

  const files = sourceFiles(WEB_SRC);
  /** @type {{file: string, count: number}[]} */
  const regionSites = [];
  let hostSites = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const regions = toastRegionMounts(source);
    if (regions > 0) regionSites.push({ file: relative(process.cwd(), file), count: regions });
    const hosts = hostMounts(source);
    if (hosts > 0) {
      hostSites += hosts;
      if (file !== LAYOUT) {
        failures.push(
          `${relative(process.cwd(), file)}: mounts NotificationHost — it belongs only in app/[locale]/layout.tsx`
        );
      }
    }
  }

  const total = regionSites.reduce((sum, site) => sum + site.count, 0);
  if (total !== 1) {
    failures.push(
      `ToastRegion is rendered ${total} time(s); exactly 1 is allowed: ` +
        regionSites.map((s) => `${s.file}x${s.count}`).join(', ')
    );
  } else if (regionSites[0] && join(process.cwd(), regionSites[0].file) !== HOST) {
    failures.push(
      `ToastRegion is rendered in ${regionSites[0].file}; it belongs in the notification host`
    );
  }

  if (hostSites !== 1) {
    failures.push(`NotificationHost is mounted ${hostSites} time(s); exactly 1 is required`);
  }

  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'apps', 'web', 'package.json'), 'utf8')
  );
  const installed = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of FORBIDDEN_PACKAGES) {
    if (name in installed) {
      failures.push(
        `${name} is installed — the application has one notification authority and it is not a library`
      );
    }
  }

  // A scan that found no files would report a clean result while checking
  // nothing, which is the failure mode this whole gate exists to prevent.
  if (files.length < 50) {
    failures.push(`only ${files.length} source file(s) scanned — the walk is broken, not the code`);
  }

  console.log(
    `Notification authority: ${files.length} file(s) scanned · ` +
      `ToastRegion renders ${total} · NotificationHost mounts ${hostSites} · ` +
      `${failures.length} failure(s).`
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      '\nTwo notification stacks are two answers to the same question, and the user ' +
        'sees whichever one happens to be on screen.'
    );
    process.exit(1);
  }
  console.log('OK: exactly one notification authority, mounted once, above every route group.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
