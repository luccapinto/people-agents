import { branding } from '@/lib/branding';

/** Product mark: an atrium seen from the inside, an open arch over a lit doorway.
 *  The arch follows the surrounding text colour and the doorway uses the brand colour, so the
 *  mark stays legible in both themes without a second asset. */
export function Logo({ size = 24, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={branding.productName}
      className={className}
    >
      <title>{branding.productName}</title>
      <path
        d="M4 20.5V12a8 8 0 0 1 16 0v8.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M2.75 20.5h18.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path
        d="M12 9.75a3.25 3.25 0 0 1 3.25 3.25v7.5h-6.5V13A3.25 3.25 0 0 1 12 9.75Z"
        fill="currentColor"
        className="text-brand"
      />
    </svg>
  );
}
