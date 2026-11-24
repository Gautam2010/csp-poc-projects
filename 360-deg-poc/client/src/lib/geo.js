// Geo/bearing math shared by the map and panorama. Ported from the original
// vanilla-JS POC (viewer/app.js) with no behavior changes.

export const EARTH_RADIUS_M = 6371000;
export const MIN_RELIABLE_DISTANCE_M = 0.5; // below this, GPS bearing is just noise

export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;

// Initial compass bearing (degrees, 0 = north) from point a to point b.
export function bearing(a, b) {
  const phi1 = toRad(a.lat), phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Great-circle distance in meters.
export function distanceMeters(a, b) {
  const phi1 = toRad(a.lat), phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);
  const sinHalfPhi = Math.sin(dPhi / 2);
  const sinHalfLambda = Math.sin(dLambda / 2);
  const h = sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Direction from `from` toward `to`, using the GPS bearing between them.
// When the two points are too close together for GPS bearing to be
// meaningful (jitter dominates), fall back to `from`'s own compass heading
// (optionally reversed, for the "backward" direction) instead.
function directionTowards(from, to, { reversed } = {}) {
  if (distanceMeters(from, to) >= MIN_RELIABLE_DISTANCE_M) {
    return bearing(from, to);
  }
  return reversed ? (from.heading + 180) % 360 : from.heading;
}

export function computeBearings(frames) {
  const n = frames.length;
  const forwardBearing = new Array(n);
  const backwardBearing = new Array(n);

  for (let i = 0; i < n - 1; i++) {
    forwardBearing[i] = directionTowards(frames[i], frames[i + 1]);
  }
  forwardBearing[n - 1] = n > 1 ? forwardBearing[n - 2] : 0;

  for (let i = 1; i < n; i++) {
    backwardBearing[i] = directionTowards(frames[i], frames[i - 1], { reversed: true });
  }
  backwardBearing[0] = n > 1 ? backwardBearing[1] : 0;

  return { forwardBearing, backwardBearing };
}

// Insta360 Studio's stabilization gyro/compass-locks the stitched video to a
// single fixed real-world orientation for the whole clip - it does not
// re-orient frame by frame to follow the vehicle's turns. So Pannellum's
// yaw 0 already means the same real-world direction in every frame, and
// scene-local yaw and world compass bearing are the same number. These are
// identities, kept as named functions (not inlined) so call sites don't
// need to change if that assumption ever needs revisiting for a different
// capture rig.
export function worldToSceneYaw(frame, worldBearingDeg) {
  return worldBearingDeg;
}
export function sceneYawToWorld(frame, sceneYawDeg) {
  return sceneYawDeg;
}

// Shortest signed angular difference a-b, in (-180, 180].
export function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

// Local flat-plane projection (meters east/north of `ref`), accurate enough
// for distances of a city block or less.
function toLocalXY(point, ref) {
  const x = (point.lon - ref.lon) * 111320 * Math.cos(toRad(ref.lat));
  const y = (point.lat - ref.lat) * 110540;
  return [x, y];
}

function pointToSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

// Distance in meters from `point` to the nearest edge of `polygon` (an
// array of [lat, lon] pairs), plus the midpoint of whichever edge is
// nearest - that midpoint is what the camera should aim at, since it's the
// closest point on the building's actual footprint, not its geometric
// center (which can point well off-target for long or L-shaped buildings).
export function nearestEdge(point, polygon) {
  const origin = [0, 0]; // point, in its own local frame
  let minDist = Infinity;
  let midpoint = null;
  for (let i = 0; i < polygon.length; i++) {
    const va = polygon[i];
    const vb = polygon[(i + 1) % polygon.length];
    const a = toLocalXY({ lat: va[0], lon: va[1] }, point);
    const b = toLocalXY({ lat: vb[0], lon: vb[1] }, point);
    const d = pointToSegmentDistance(origin, a, b);
    if (d < minDist) {
      minDist = d;
      midpoint = { lat: (va[0] + vb[0]) / 2, lon: (va[1] + vb[1]) / 2 };
    }
  }
  return { distance: minDist, midpoint };
}

// The capture vehicle rides roughly parallel to the buildings it's filming,
// so "look at this property" isn't a fixed frame/angle: find whichever
// capture point is physically closest to the property, then aim the view
// at the real bearing from that point toward the property (typically close
// to perpendicular to the direction of travel).
export function nearestFrameForProperty(frames, property) {
  let idx = 0;
  let target = null;

  if (property.polygon) {
    let bestDistance = Infinity;
    frames.forEach((f, i) => {
      const edge = nearestEdge(f, property.polygon);
      if (edge.distance < bestDistance) {
        bestDistance = edge.distance;
        idx = i;
        target = edge.midpoint;
      }
    });
  } else {
    let bestDistance = Infinity;
    frames.forEach((f, i) => {
      const d = distanceMeters(f, property);
      if (d < bestDistance) {
        bestDistance = d;
        idx = i;
      }
    });
    target = property;
  }

  return { index: idx, yaw: bearing(frames[idx], target) };
}
