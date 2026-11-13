// Story 25.7: the Natural Earth (Patterson-like pseudocylindrical, "Natural Earth I") projection as plain local code, so a dot can be placed at request time
// without d3. The country shapes (africaMap.generated.ts) were projected once at build time by d3's `geoNaturalEarth1` with the `scale` and `translate`
// stored in that module; `projectPoint` applies the same formula to the same parameters. apps/landing/lib/directory/map.test.ts proves it equal to d3's
// projection at sample points, and that the committed module is what a fresh generation produces.
//
// d3-geo's naturalEarth1Raw, with its default rotation (none), centre (0, 0) and no clipping: x = translate.x + scale * rawX(lambda, phi),
// y = translate.y - scale * rawY(lambda, phi), lambda and phi in radians.

/** The data the generator writes: a view box, the fitted projection and one path per country (alpha-2 upper case). */
export interface AfricaMapData {
  /** View box width: the radius rule of the dots is stated in this unit. */
  width: number;
  height: number;
  /** d3 `projection.scale()` and `projection.translate()` after fitting. */
  scale: number;
  translate: [number, number];
  /** Countries of the map's area with a shape in the 110 m data. */
  countries: { code: string; d: string }[];
  /** African codes with no shape at 110 m (small islands): a city there is placed by its coordinates if it falls inside the view box. */
  absent: string[];
}

const RAD = Math.PI / 180;

/** d3-geo `geoNaturalEarth1Raw`: the unscaled projection of a point (radians). */
export function naturalEarth1Raw(lambda: number, phi: number): [number, number] {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

/** The view-box position of a point, as d3's `geoNaturalEarth1().scale(scale).translate(translate)([lng, lat])` returns it. */
export function projectPoint(map: Pick<AfricaMapData, "scale" | "translate">, lat: number, lng: number): [number, number] {
  const [x, y] = naturalEarth1Raw(lng * RAD, lat * RAD);
  return [map.translate[0] + map.scale * x, map.translate[1] - map.scale * y];
}
