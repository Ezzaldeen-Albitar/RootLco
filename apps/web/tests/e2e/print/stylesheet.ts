import { join } from 'node:path';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import * as sass from 'sass';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../../../tailwind.config';

const WEB = join(__dirname, '..', '..', '..');

/**
 * The application's stylesheet, compiled the way the build compiles it.
 *
 * `app/globals.scss` through Sass, then the workspace's PostCSS chain
 * (`postcss.config.mjs`: Tailwind, then Autoprefixer) with the workspace's own
 * Tailwind configuration. The content globs are made absolute so the utilities
 * the documents use are generated whatever directory the runner starts in.
 * This is what a printed page is styled by; nothing here is a test double.
 */
export async function applicationStylesheet(): Promise<string> {
  const compiled = sass.compile(join(WEB, 'src', 'app', 'globals.scss')).css;
  const content = [join(WEB, 'src', '**', '*.{ts,tsx}').split('\\').join('/')];
  const result = await postcss([tailwindcss({ ...tailwindConfig, content }), autoprefixer]).process(
    compiled,
    { from: undefined }
  );
  return result.css;
}
