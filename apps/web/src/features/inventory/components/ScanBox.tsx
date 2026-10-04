'use client';

/**
 * The scan box (P1-32): a keyboard-wedge scanner, a person typing, or the
 * device camera — all producing one code, once.
 *
 * ## Three ways in, one way out
 *
 * A handheld scanner is a keyboard: it types the code and presses Enter. That
 * is the whole of "wedge support", and it is why the control is an ordinary
 * text field — a person with no scanner types the same code into the same box
 * and presses the same key. The camera is the third way in and is OPTIONAL: it
 * is offered only when the browser publishes `BarcodeDetector` and a camera can
 * be opened, and when it cannot the box says so plainly and manual entry stays
 * exactly where it was.
 *
 * ## Duplicate-frame protection, and why it is not enough on its own
 *
 * One physical scan can deliver two frames — a wedge repeat, or two camera
 * frames of the same label a few milliseconds apart. The same code arriving
 * inside `DUPLICATE_FRAME_WINDOW_MS` is therefore IGNORED, and the box says it
 * was ignored rather than silently dropping it: an operator who genuinely
 * scanned the same part twice has to be able to tell.
 *
 * That window is a convenience, not a guarantee. The guarantee is that a scan
 * never writes anything by itself. A scan RESOLVES a code — a read — and the
 * write waits for an explicit confirmation by the person at the counter, who is
 * the only one who can say whether the second identical part is a second part.
 * The idempotency key is derived once at that confirmation, so a retry after a
 * lost answer replays the first write rather than repeating it. Those two rules
 * are the caller's, which is why this component performs no write at all.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

import { MAX_IDENTIFIER_VALUE } from '../inventory-contract';
import { SECONDARY_BUTTON } from './shared';

/**
 * How long the same code is treated as a repeat of the frame before it.
 *
 * Long enough to absorb a doubled wedge frame and a camera running at any
 * ordinary rate; short enough that an operator deliberately scanning two
 * identical parts is not made to wait for the box to forget.
 */
export const DUPLICATE_FRAME_WINDOW_MS = 1500;

/**
 * What the camera half of the box is currently doing.
 *
 * Whether a camera is REACHABLE at all is a separate question, answered by the
 * browser rather than by this component, and it is read through
 * `useSyncExternalStore` instead of being discovered in an effect: the server
 * render knows there is no camera, the client render knows whether there is, and
 * neither has to render twice to find out.
 */
type CameraState =
  /** Available and not running. */
  | 'idle'
  | 'starting'
  | 'running'
  /** The person, or the platform, said no. */
  | 'denied'
  /** It was started and stopped answering. */
  | 'failed';

/** The slice of the browser API this component uses, named so it can be reasoned about. */
interface DetectorLike {
  detect(source: CanvasImageSource): Promise<readonly { rawValue: string }[]>;
}
interface DetectorConstructor {
  new (options?: { formats?: readonly string[] }): DetectorLike;
}

/** Feature detection, in one place, guarded for the server render. */
function detectorConstructor(): DetectorConstructor | null {
  if (typeof window === 'undefined') return null;
  const found = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  return typeof found === 'function' ? found : null;
}

function cameraIsReachable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Capability, read as an external fact.
 *
 * It never changes while the page is open, so the subscription is a no-op; the
 * server snapshot is `false`, which is what makes the first client render agree
 * with the markup it hydrates.
 */
const NEVER_CHANGES = () => () => {};
const cameraCapableNow = (): boolean => detectorConstructor() !== null && cameraIsReachable();
const cameraCapableOnServer = (): boolean => false;

export function ScanBox({
  messages,
  idPrefix,
  label,
  description,
  onCode,
  disabled = false,
}: {
  readonly messages: Messages;
  /** Distinguishes two boxes on one page; part of no visible text. */
  readonly idPrefix: string;
  readonly label: string;
  readonly description?: string;
  /** Called once per accepted code. A READ follows; a write waits for a confirmation. */
  readonly onCode: (code: string) => void;
  readonly disabled?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [repeated, setRepeated] = useState<string | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [camera, setCamera] = useState<CameraState>('idle');
  const cameraCapable = useSyncExternalStore(
    NEVER_CHANGES,
    cameraCapableNow,
    cameraCapableOnServer
  );
  const previous = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  /** Accept a code, unless it repeats the frame before it. */
  const accept = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (code.length === 0) return;
      if (code.length > MAX_IDENTIFIER_VALUE) {
        setTooLong(true);
        return;
      }
      setTooLong(false);
      const now = Date.now();
      const before = previous.current;
      if (code === before.code && now - before.at < DUPLICATE_FRAME_WINDOW_MS) {
        // Said out loud. A dropped scan an operator is not told about is
        // indistinguishable from a scanner that has stopped working.
        previous.current = { code, at: now };
        setRepeated(code);
        return;
      }
      previous.current = { code, at: now };
      setRepeated(null);
      onCode(code);
    },
    [onCode]
  );

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  // The camera is a device, and a device left running is a light left on.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    const Detector = detectorConstructor();
    /* c8 ignore next 4 -- the button is not rendered at all unless the capability
       read above says both halves are present; this is the belt to that brace. */
    if (Detector === null || !cameraIsReachable()) {
      setCamera('failed');
      return;
    }
    setCamera('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
    } catch {
      // Refused by the person or by the platform. Both end the same way, and
      // neither takes the typed box away.
      setCamera('denied');
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (video === null) {
      stopCamera();
      setCamera('failed');
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      stopCamera();
      setCamera('failed');
      return;
    }
    const detector = new Detector();
    setCamera('running');
    loopRef.current = window.setInterval(() => {
      const element = videoRef.current;
      if (element === null) return;
      void detector
        .detect(element)
        .then((found) => {
          const first = found[0];
          if (first !== undefined) accept(first.rawValue);
        })
        .catch(() => {
          stopCamera();
          setCamera('failed');
        });
    }, 400);
  }, [accept, stopCamera]);

  const noteKey = !cameraCapable
    ? 'inventory.scan.camera.unsupported'
    : camera === 'denied'
      ? 'inventory.scan.camera.denied'
      : camera === 'failed'
        ? 'inventory.scan.camera.failed'
        : null;

  return (
    <div className="flex flex-col gap-2" data-scan={idPrefix}>
      <TextField
        label={label}
        {...(description === undefined ? {} : { description })}
        value={typed}
        inputMode="text"
        dir="ltr"
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          // A wedge scanner ends its transmission with Enter, and a person
          // typing presses the same key. One path serves both.
          if (event.key !== 'Enter') return;
          event.preventDefault();
          accept(typed);
          setTyped('');
        }}
        error={tooLong ? translate(messages, 'inventory.scan.tooLong') : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={disabled}
          onClick={() => {
            accept(typed);
            setTyped('');
          }}
        >
          {translate(messages, 'inventory.scan.submit')}
        </button>
        {cameraCapable && (camera === 'idle' || camera === 'denied' || camera === 'failed') ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={disabled}
            onClick={() => {
              void startCamera();
            }}
          >
            {translate(messages, 'inventory.scan.camera.start')}
          </button>
        ) : null}
        {cameraCapable && camera === 'running' ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => {
              stopCamera();
              setCamera('idle');
            }}
          >
            {translate(messages, 'inventory.scan.camera.stop')}
          </button>
        ) : null}
      </div>
      {noteKey !== null ? (
        <p className="text-caption text-text-muted">{translate(messages, noteKey)}</p>
      ) : null}
      {repeated !== null ? (
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          {translate(messages, 'inventory.scan.repeatIgnored')}{' '}
          <code className="font-mono" dir="ltr">
            {repeated}
          </code>
        </p>
      ) : null}
      {/*
       * A live viewfinder, hidden from assistive technology: it carries no
       * information a screen reader could use, and the code it finds is
       * announced by the caller as text.
       */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        className={
          cameraCapable && camera === 'running'
            ? 'w-full max-w-xs rounded-md border border-border'
            : 'hidden'
        }
      />
    </div>
  );
}
