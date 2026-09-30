import type { SVGProps } from 'react';

/** Props every icon artwork accepts (Tabler's components take the same ones). */
export interface IconArtProps extends Omit<SVGProps<SVGSVGElement>, 'stroke' | 'ref'> {
  readonly size?: number | string;
  readonly stroke?: number | string;
}

/**
 * Drawn in Tabler's style (24×24 grid, `currentColor` outline, round caps) for topics Tabler has no
 * fitting icon for: gas is a gas bottle — a flame would read as fire — and a roof with a chimney.
 */
function art(paths: readonly string[], name: string) {
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
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
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
