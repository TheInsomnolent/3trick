import type { GridDimensions, Position, TerrainGetter } from './types'

function key(x: number, y: number) {
  return `${x},${y}`
}

// Neighbour offsets used by the BFS expansion below. Orthogonals come first
// so that equal-length paths (e.g. walking due north across open ground)
// resolve to a straight line instead of zig-zagging through diagonals.
const ORTHOGONAL_OFFSETS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]
const DIAGONAL_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
]
const NEIGHBOUR_OFFSETS: ReadonlyArray<[number, number]> = [
  ...ORTHOGONAL_OFFSETS,
  ...DIAGONAL_OFFSETS,
]

/**
 * OSRS-style breadth-first search across walkable (land) tiles. Returns the
 * full path from `from` to `to`, exclusive of `from`.
 *
 * Mirrors the pathfinder described on the OSRS Wiki
 * (https://oldschool.runescape.wiki/w/Pathfinding):
 *   - Players may walk in any of 8 directions (4 orthogonal + 4 diagonal).
 *   - A diagonal step is only permitted when both flanking orthogonal tiles
 *     are walkable, i.e. no corner cutting around a blocked tile.
 *   - If the destination tile itself is not walkable (e.g. the player clicked
 *     a water tile or the fishing spot), we retarget to the closest walkable
 *     neighbour so the player at least walks up to the shoreline.
 */
export function findPath(
  from: Position,
  to: Position,
  dims: GridDimensions,
  terrain: TerrainGetter,
): Position[] {
  if (from.x === to.x && from.y === to.y) {
    return []
  }

  const walkable = (p: Position) =>
    p.x >= 0 &&
    p.x < dims.width &&
    p.y >= 0 &&
    p.y < dims.height &&
    terrain(p.x, p.y) === 'land'

  // If the destination is unwalkable, retarget to the closest walkable
  // neighbour (orthogonal or diagonal) so the player at least walks up to
  // the shoreline. Diagonal neighbours obey the no-corner-cutting rule.
  let target = to
  if (!walkable(to)) {
    const candidates: Position[] = []
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const n = { x: to.x + dx, y: to.y + dy }
        if (!walkable(n)) continue
        if (dx !== 0 && dy !== 0) {
          // No corner cutting: both orthogonal flankers must be walkable.
          if (!walkable({ x: to.x + dx, y: to.y })) continue
          if (!walkable({ x: to.x, y: to.y + dy })) continue
        }
        candidates.push(n)
      }
    }
    if (candidates.length === 0) {
      return []
    }
    candidates.sort(
      (a, b) =>
        Math.max(Math.abs(a.x - from.x), Math.abs(a.y - from.y)) -
        Math.max(Math.abs(b.x - from.x), Math.abs(b.y - from.y)),
    )
    target = candidates[0]
  }

  if (!walkable(from)) {
    return []
  }

  const cameFrom = new Map<string, Position | null>()
  cameFrom.set(key(from.x, from.y), null)
  const queue: Position[] = [from]

  while (queue.length > 0) {
    const current = queue.shift() as Position
    if (current.x === target.x && current.y === target.y) {
      const path: Position[] = []
      let step: Position | null = current
      while (step) {
        const parent: Position | null = cameFrom.get(key(step.x, step.y)) ?? null
        if (parent) {
          path.push(step)
        }
        step = parent
      }
      return path.reverse()
    }
    // Expand all 8 neighbours, but reject diagonals that would cut a corner
    // around a blocked tile (RuneScape rule). Orthogonal neighbours are
    // enqueued before diagonal ones so that, when several equal-length
    // paths exist (e.g. walking due north across open ground), BFS prefers
    // the straight path instead of zig-zagging through diagonals.
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const next = { x: current.x + dx, y: current.y + dy }
      if (!walkable(next)) continue
      if (dx !== 0 && dy !== 0) {
        if (!walkable({ x: current.x + dx, y: current.y })) continue
        if (!walkable({ x: current.x, y: current.y + dy })) continue
      }
      const k = key(next.x, next.y)
      if (cameFrom.has(k)) {
        continue
      }
      cameFrom.set(k, current)
      queue.push(next)
    }
  }

  return []
}

/**
 * Advance along a path by up to `steps` tiles, returning the new player
 * position and the remaining path.
 */
export function advanceAlongPath(
  player: Position,
  path: Position[],
  steps: number,
): { position: Position; remaining: Position[] } {
  if (path.length === 0 || steps <= 0) {
    return { position: player, remaining: path }
  }
  const taken = Math.min(steps, path.length)
  return {
    position: path[taken - 1],
    remaining: path.slice(taken),
  }
}
