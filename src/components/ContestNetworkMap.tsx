import { Globe2, Map as MapIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { mercatorY } from '../utils/cityOverview';
import { contestDistrictPolygons } from '../utils/contestQuestions';
import type { Point, PublishedCity } from '../utils/localTransit';

function viewBox(points: Point[]) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const margin = Math.max(width, height) * .035;
  return [left - margin, top - margin, width + margin * 2, height + margin * 2].join(' ');
}

type Props = {
  catalog: PublishedCity[];
  region: { id: string; title: string; cityScope?: string; provinceScope?: string };
  loading: boolean;
};

export function ContestNetworkMap({ catalog, region, loading }: Props) {
  const reduceMotion = useReducedMotion();
  const { cityScope, provinceScope } = region;
  const map = useMemo(() => {
    if (!cityScope && !provinceScope) return null;

    const cities = catalog.filter(city => city.thumbnail &&
      (cityScope ? city.city === cityScope : city.province === provinceScope));
    if (!cities.length) return null;

    const west = Math.min(...cities.map(city => city.bounds[0]));
    const north = Math.max(...cities.map(city => city.bounds[3]));
    const scale = 1000 / (Math.max(...cities.map(city => city.bounds[2])) - west);
    const project = ([lng, lat]: Point): Point => [(lng - west) * scale, (mercatorY(north) - mercatorY(lat)) * scale];
    const images = cities.map(city => {
      const [minLng, minLat, maxLng, maxLat] = city.bounds;
      const [x, y] = project([minLng, maxLat]);
      const [right, bottom] = project([maxLng, minLat]);
      return { href: city.thumbnail, x, y, width: right - x, height: bottom - y };
    });
    const paths = cityScope ? contestDistrictPolygons(cityScope).map(polygon =>
      polygon.map(ring => ring.map(project))) : [];
    const fullFrame = viewBox(images.flatMap(({ x, y, width, height }) => [[x, y], [x + width, y + height]]));
    return { images, fullFrame, closeFrame: paths.length ? viewBox(paths.flat(2)) : fullFrame };
  }, [catalog, cityScope, provinceScope]);

  const label = cityScope ? `${region.title}全市线网` : `${region.title}线网`;
  return <motion.div layoutId={reduceMotion ? undefined : `network-${region.id}`} className="contest-network"
    style={{ borderRadius: 16 }}>
    {map ? <motion.svg className="absolute inset-0 h-full w-full" role="img" aria-label={label}
      initial={reduceMotion ? false : { viewBox: map.closeFrame }}
      animate={{ viewBox: map.fullFrame }}
      transition={{ duration: reduceMotion ? 0 : .48, ease: [0.22, 1, 0.36, 1] }}>
      {map.images.map(({ href, ...geometry }) => <image key={href} {...geometry}
        href={`${import.meta.env.BASE_URL}city-data/v1/${href}`} preserveAspectRatio="none" />)}
    </motion.svg> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-m3-primary">
      {!cityScope && !provinceScope ? <Globe2 aria-hidden="true" className="h-1/2 max-h-28 w-1/2 opacity-75" strokeWidth={1} />
        : <span role="status"><MapIcon aria-hidden="true" className="mx-auto mb-1.5 opacity-70" size={22} />
          {loading ? '读取线网…' : '暂无线网概览'}
        </span>}
    </div>}
  </motion.div>;
}
