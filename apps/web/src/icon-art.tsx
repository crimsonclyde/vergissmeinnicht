import type { SVGProps } from 'react';

/** Props every icon artwork accepts (Tabler's components take the same ones). */
export interface IconArtProps extends Omit<SVGProps<SVGSVGElement>, 'stroke' | 'ref'> {
  readonly size?: number | string;
  readonly stroke?: number | string;
}

/** A path, optionally rotated about a point (`rotate(angle x y)`) to repeat a shape such as a fan blade. */
type ArtPath = string | { readonly d: string; readonly transform: string };

/**
 * Drawn in Tabler's style (24×24 grid, `currentColor` outline, round caps) for household topics
 * Tabler 3.48 has no icon for — e.g. gas is a gas bottle (a flame would read as fire), a fan, a radiator.
 */
function art(paths: readonly ArtPath[], name: string) {
  function Art({ size = 24, stroke = 2, className, ...rest }: IconArtProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className === undefined ? 'vmn-icon' : `vmn-icon ${className}`}
        {...rest}
      >
        {paths.map((path) =>
          typeof path === 'string' ? <path key={path} d={path} /> : <path key={path.d + path.transform} d={path.d} transform={path.transform} />,
        )}
      </svg>
    );
  }
  Art.displayName = name;
  return Art;
}

export const GasBottleArt = art(
  ['M10 3h4', 'M12 3v3', 'M10 6h4a4 4 0 0 1 4 4v7a4 4 0 0 1 -4 4h-4a4 4 0 0 1 -4 -4v-7a4 4 0 0 1 4 -4z', 'M6 12h12'],
  'GasBottleArt',
);

export const ChimneyArt = art(['M3 13l9 -8l9 8', 'M5 11v9h14v-9', 'M15 7.7v-3.7h3v6.3', 'M17.5 1.8c.7 -.6 1.6 -.6 2.3 0'], 'ChimneyArt');

const FAN_BLADE = 'M12 10c-.4 -2.3 .4 -4.2 2.4 -5c1 1.9 .3 4 -2.4 5';

export const FanArt = art(
  [
    'M12 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0',
    FAN_BLADE,
    { d: FAN_BLADE, transform: 'rotate(120 12 10)' },
    { d: FAN_BLADE, transform: 'rotate(240 12 10)' },
    'M12 17v3',
    'M8 21h8',
  ],
  'FanArt',
);

export const RadiatorArt = art(
  [
    'M4 7a2 2 0 0 1 4 0v10a2 2 0 0 1 -4 0z',
    'M8 7a2 2 0 0 1 4 0v10a2 2 0 0 1 -4 0z',
    'M12 7a2 2 0 0 1 4 0v10a2 2 0 0 1 -4 0z',
    'M16 7a2 2 0 0 1 4 0v10a2 2 0 0 1 -4 0z',
    'M6 19v2',
    'M18 19v2',
  ],
  'RadiatorArt',
);

export const BoilerArt = art(
  [
    'M8 3h8a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z',
    'M12 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M12 16.5c-1.2 -.6 -1.2 -2 0 -3c1.2 1 1.2 2.4 0 3',
    'M9 19v2',
    'M15 19v2',
  ],
  'BoilerArt',
);

export const FuseBoxArt = art(
  [
    'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
    'M4 8h16',
    'M7 11h2v6h-2z',
    'M11 11h2v6h-2z',
    'M15 11h2v6h-2z',
    'M8 13v1',
    'M12 13v1',
    'M16 13v1',
  ],
  'FuseBoxArt',
);

export const ValveArt = art(['M7 12h10v5h-10z', 'M3 14.5h4', 'M17 14.5h4', 'M3 12v5', 'M21 12v5', 'M12 12v-5', 'M8 7h8'], 'ValveArt');

export const ShowerArt = art(
  ['M5 21v-14a3 3 0 0 1 3 -3h5a3 3 0 0 1 3 3v1', 'M13 11a3 3 0 0 1 6 0z', 'M14 14v1', 'M16 14v1', 'M18 14v1', 'M15 17v1', 'M17 17v1'],
  'ShowerArt',
);

export const SinkArt = art(
  ['M9 3h4', 'M11 3v3', 'M7 17v-9a2 2 0 0 1 2 -2h5a3 3 0 0 1 3 3v2', 'M17 14v.01', 'M3 17h18', 'M5 17a7 4 0 0 0 14 0'],
  'SinkArt',
);

export const DishwasherArt = art(
  [
    'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
    'M4 8h16',
    'M7 5.5v.01',
    'M10 5.5v.01',
    'M7 18h10',
    'M8.5 18v-4a1.5 1.5 0 0 1 3 0v4',
    'M12.5 18v-4a1.5 1.5 0 0 1 3 0v4',
  ],
  'DishwasherArt',
);

export const ShutterArt = art(['M3 4h18v3h-18z', 'M5 7v12', 'M19 7v12', 'M5 10h14', 'M5 13h14', 'M5 16h14', 'M5 19h14', 'M12 19v2'], 'ShutterArt');
