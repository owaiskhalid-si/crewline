export type LatLng = { lat: number; lng: number };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceM(path[i - 1], path[i]);
  return total;
}

/** The point a given share of the way along a path, measured by distance. */
export function pointAlong(path: LatLng[], share: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (share <= 0 || path.length === 1) return path[0];
  if (share >= 1) return path[path.length - 1];
  let left = pathLengthM(path) * share;
  for (let i = 1; i < path.length; i++) {
    const step = distanceM(path[i - 1], path[i]);
    if (left <= step && step > 0) {
      const k = left / step;
      return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * k, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * k };
    }
    left -= step;
  }
  return path[path.length - 1];
}

/** The part of a path up to a given share, for drawing where someone has already been. */
export function pathUpTo(path: LatLng[], share: number): LatLng[] {
  if (share <= 0 || path.length === 0) return path.slice(0, 1);
  if (share >= 1) return path;
  let left = pathLengthM(path) * share;
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const step = distanceM(path[i - 1], path[i]);
    if (left <= step) {
      out.push(pointAlong([path[i - 1], path[i]], step ? left / step : 0));
      return out;
    }
    out.push(path[i]);
    left -= step;
  }
  return out;
}

/** Decodes a Google polyline (precision 5), the format the routing service returns. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Toronto's street grid runs about 17 degrees off north. */
const GRID_ANGLE = rad(-17);

/**
 * A rough street-shaped path, used until a real route arrives: one turn, along the
 * city's grid, which looks far more honest on a map than a straight line through buildings.
 */
export function gridPath(a: LatLng, b: LatLng): LatLng[] {
  const scale = Math.cos(rad(a.lat));
  const dx = (b.lng - a.lng) * scale;
  const dy = b.lat - a.lat;
  const along = dx * Math.sin(GRID_ANGLE) + dy * Math.cos(GRID_ANGLE);
  const corner: LatLng = {
    lat: a.lat + along * Math.cos(GRID_ANGLE),
    lng: a.lng + (along * Math.sin(GRID_ANGLE)) / scale,
  };
  return [a, corner, b];
}

/** Clock time from minutes after midnight: 690 is 11:30. */
export function fmtClock(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
