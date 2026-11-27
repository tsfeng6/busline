import { routeName } from './localTransit';

const palette = [
  '#2563EB', '#C2410C', '#087F5B', '#7E22CE', '#A16207', '#BE185D',
  '#0E7490', '#854D3D', '#4D7C0F', '#4338CA', '#8E233A', '#475569',
];

function routeColor(index: number): string {
  if (index < palette.length) return palette[index];
  // Keep assigning distinct hues at large hubs. Use hex for both map renderers.
  const sector = (index * 0.61803398875 % 1) * 6;
  const chroma = 0.6;
  const secondary = chroma * (1 - Math.abs(sector % 2 - 1));
  const rgb = [
    [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
  ][Math.floor(sector)];
  return '#' + rgb.map(value => Math.round((value + 0.13) * 255).toString(16).padStart(2, '0')).join('');
}

export function contestRouteColors(lines: readonly { name: string }[]): string[] {
  const colors = new Map<string, string>();
  return lines.map(line => {
    const name = routeName(line.name);
    const color = colors.get(name) ?? routeColor(colors.size);
    colors.set(name, color);
    return color;
  });
}
