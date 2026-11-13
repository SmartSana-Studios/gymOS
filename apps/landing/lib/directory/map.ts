// Story 25.7 (AD-44, AD-49): what the Africa map of the top page shows, as plain data for markup.tsx. The shapes are the committed generated module; the dots are
// placed at request time from `directory_city` lat/lng by the local Natural Earth projection (mapProjection.ts, proven equal to d3's).
//
// Rules (DESIGN.md "Africa map"): one dot per city with a published gym, radius 5 + 3.2 * sqrt(gyms) in the 760-unit view box; position is the city's OWN
// coordinates, never a gym's. A city without coordinates (not in the rows given), outside the map's area or in a country off the map has no dot but stays
// listed and counted by the cards. A country with a listed gym uses the lighter fill; no country is otherwise singled out. The caption does not claim completeness.
import { AFRICA_MAP } from "./africaMap.generated";
import { projectPoint, type AfricaMapData } from "./mapProjection";
import type { MapDotView, MapView } from "./markup";
import type { DirectoryCopy } from "./copy";
import type { MapCityRow } from "./types";

/** Dot radius for a city with `gyms` published gyms, in view-box units. */
export const dotRadius = (gyms: number): number => Math.round((5 + 3.2 * Math.sqrt(Math.max(0, gyms))) * 100) / 100;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The African codes of the map: those with a shape and those the 110 m data omits (small islands, placed by coordinates when they fall inside the box). */
const onTheMap = (data: AfricaMapData): Set<string> => new Set([...data.countries.map((c) => c.code), ...data.absent]);

/**
 * `listed` is the set of upper-case alpha-2 codes of the countries the cards list (a country with a listed gym); `cities` are the rows of
 * `directory_city` that carry coordinates; `cityHref` gives the root-relative city page path (the handler's `directoryPath`). Returns null when no country is listed (nothing published anywhere: no map).
 */
export function buildMapView(
  input: { copy: DirectoryCopy; listed: ReadonlySet<string>; cities: readonly MapCityRow[]; cityHref: (countryCode: string, citySlug: string) => string },
  data: AfricaMapData = AFRICA_MAP,
): MapView | null {
  const { copy, listed, cities, cityHref } = input;
  if (listed.size === 0) return null;
  const area = onTheMap(data);
  const dots = cities
    .filter((c) => c.publishedCount > 0 && listed.has(c.countryCode) && area.has(c.countryCode) && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)
    .flatMap((c) => {
      const [x, y] = projectPoint(data, c.lat, c.lng);
      // outside the view box: the continent's area is the extent; a point beyond it (an island group the 110 m data omits) has no dot
      if (!(x >= 0 && x <= data.width && y >= 0 && y <= data.height)) return [];
      const dot: MapDotView = {
        x: round1(x),
        y: round1(y),
        r: dotRadius(c.publishedCount),
        href: cityHref(c.countryCode, c.citySlug),
        label: `${c.cityName} · ${copy.gymCount(c.publishedCount)}`,
        anchor: x > data.width * 0.7 ? "end" : x < data.width * 0.3 ? "start" : "middle",
      };
      return [{ dot, gyms: c.publishedCount, key: `${c.countryCode}/${c.citySlug}` }];
    })
    // the larger dots first, so a small dot is drawn (and hit) on top of a large neighbour; the slug breaks ties so the markup is stable
    .sort((a, b) => b.gyms - a.gyms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((e) => e.dot);
  return {
    width: data.width,
    height: data.height,
    caption: copy.top.mapCaption,
    countries: data.countries.map((c) => ({ code: c.code, d: c.d, lit: listed.has(c.code) })),
    dots,
  };
}
