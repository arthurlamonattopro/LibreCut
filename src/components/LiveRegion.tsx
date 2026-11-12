import { useLiveRegion } from "../lib/announce";

/**
 * The screen reader channels for the whole app.
 *
 * Polite and assertive messages are kept apart so a failure can interrupt
 * the speech without every status change doing the same.
 */
export function LiveRegion() {
  const polite = useLiveRegion((state) => state.polite);
  const assertive = useLiveRegion((state) => state.assertive);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite ? <p key={polite.id}>{polite.text}</p> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive ? <p key={assertive.id}>{assertive.text}</p> : null}
      </div>
    </>
  );
}
