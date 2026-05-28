import type { GridDimensions, Position, SpotSpawnRule, TerrainGetter } from './types'

/**
 * Terrain layout used by the 3-tick fishing sims: the right half of the
 * grid is water, the left half is land. Kept here (rather than inlined in
 * the trainer) so it can be reused, and so swapping it out for a different
 * layout is just a one-line change.
 */
export function splitWaterRight(width: number): TerrainGetter {
  const shoreStart = Math.floor(width / 2)
  return (x) => (x >= shoreStart ? 'water' : 'land')
}

/**
 * Spawn rule for fishing: spots must be on a water tile that is orthogonally
 * adjacent to at least one land tile (i.e. on the shoreline).
 */
export const fishingSpotOnShoreline: SpotSpawnRule = (x, y, terrain, dims) => {
  if (terrain(x, y) !== 'water') {
    return false
  }
  const neighbours: Position[] = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ]
  return neighbours.some(
    (n) =>
      n.x >= 0 &&
      n.x < dims.width &&
      n.y >= 0 &&
      n.y < dims.height &&
      terrain(n.x, n.y) === 'land',
  )
}

/**
 * Enumerate every tile that satisfies the spawn rule, then pick one at
 * random. Callers can pass an optional `exclude` position to avoid picking
 * the same tile the spot is currently on.
 */
export function pickSpawnTile(
  dims: GridDimensions,
  terrain: TerrainGetter,
  rule: SpotSpawnRule,
  exclude?: Position | null,
): Position | null {
  const candidates: Position[] = []
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      if (exclude && exclude.x === x && exclude.y === y) {
        continue
      }
      if (rule(x, y, terrain, dims)) {
        candidates.push({ x, y })
      }
    }
  }
  if (candidates.length === 0) {
    return null
  }
  return candidates[Math.floor(Math.random() * candidates.length)]
}
