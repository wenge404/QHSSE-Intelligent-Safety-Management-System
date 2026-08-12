/**
 * Inline SVG icon set.
 *
 * Deliberately not an icon package: a dozen 24px glyphs do not justify a
 * dependency, and inlining them keeps the bundle free of an external font or
 * sprite request.
 */

type IconProps = { className?: string };

const base = 'h-[18px] w-[18px] shrink-0';

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Svg>
);

export const IconIncident = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const IconAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
    <path d="M9 3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2" />
    <path d="m14 12 2 2 5-5" />
    <path d="M7 12h4" />
    <path d="M7 16h6" />
  </Svg>
);

export const IconAction = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22a10 10 0 1 0-10-10" />
    <path d="m2 12 3 3 3-3" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const IconModel = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="m7 15 3.5-4 3 2.5L20 7" />
  </Svg>
);

export const IconAdmin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.2 2.6a1 1 0 0 0-.4 0l-7 2.3a1 1 0 0 0-.8 1V12c0 5 3.4 8.3 7.6 9.9a1 1 0 0 0 .8 0C16.6 20.3 20 17 20 12V5.9a1 1 0 0 0-.8-1Z" />
    <path d="m9.5 12 1.8 1.8 3.5-3.6" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const IconSignOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
