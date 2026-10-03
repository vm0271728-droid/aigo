// ============ Physics/pathfinding helpers for bots (re-exports + nav wrapper) ============
import { findPath } from './map.js';

export { groundHeightAt, resolveCollisions, rayCastWorld, RADIUS } from './player.js';

// Find a navigation path from an entity's foot position to a destination point.
// Uses the map nav-graph (Dijkstra). Returns array of THREE.Vector3 waypoints.
export function findPathTarget(col, fromP, destP) {
  const a = fromP.clone ? fromP.clone().setY(0) : fromP;
  const b = destP.clone ? destP.clone().setY(0) : destP;
  return findPath(a, b);
}
