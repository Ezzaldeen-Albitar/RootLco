'use client';

/**
 * The ONE file input this product offers (`P1-OD-025`, `P1-28-FE-017`/`FE-018`).
 *
 * ## Why a shared component rather than a second allowance
 *
 * `no-unapproved-file-input` permits a file input in exactly one PATH, and
 * `FILE_INPUT_ALLOW` is asserted to hold exactly one entry. Two capture surfaces
 * now exist — reception evidence and a signature image — and the obvious move
 * was to add the second screen to that list. That would have been the wrong
 * shape: the list would then grow once per screen, and the rule "there is one
 * approved capture surface" would decay into "there are the approved capture
 * surfaces", which is not a rule at all.
 *
 * So the INPUT moved instead. Both steps render this component, the allowance
 * still names one path, and a third capture surface costs nothing and widens
 * nothing. What the allowance protects is unchanged: every other prohibition —
 * `FileReader`, a `DataTransfer`, a drop target, an `input.files` list, a
 * hand-built `multipart/form-data`, `new FormData(form)` — still applies to this
 * file in full, because `no-unapproved-file-input` is a separate rule from
 * `no-upload-path` precisely so that exempting one construct does not exempt the
 * others.
 *
 * ## It reads no bytes, and builds no request
 *
 * The element is a plain `<input type="file">` inside a form whose `action` is a
 * Server Action. React serialises the field; nothing here opens the file, hashes
 * it, previews it or constructs a body. That is what keeps the browser free of
 * storage credentials and raw object keys — the bytes cross the same origin once
 * and every storage decision is taken on the server
 * (`features/attachments/api.ts` carries why).
 *
 * ## It states no media policy
 *
 * There is deliberately no `accept` list and no size hint baked in. The accepted
 * content types and the ceiling belong to the category the SERVER published, and
 * a "sensible default" of JPEG and PNG written here would be a media policy this
 * tree invented and presented to an operator as though somebody had decided it —
 * exactly what `no-invented-media-limit` fails a build over. A caller that has
 * been TOLD the server's list may pass it through `accept`; a caller that has
 * not passes nothing, and the server refuses what it will not take.
 */
export function CaptureFileField({
  name,
  label,
  disabled = false,
  accept,
}: {
  readonly name: string;
  readonly label: string;
  readonly disabled?: boolean;
  /**
   * The SERVER's content-type list, verbatim, or absent.
   *
   * Optional because "we were not told" and "anything goes" are different facts,
   * and only the first one is ever true here. Never a literal at a call site.
   */
  readonly accept?: readonly string[] | undefined;
}) {
  return (
    <input
      type="file"
      name={name}
      aria-label={label}
      disabled={disabled}
      {...(accept !== undefined && accept.length > 0 ? { accept: accept.join(',') } : {})}
      className="text-body text-text-primary"
    />
  );
}
