import type { GridDimensions, Position, TerrainGetter } from './types'

function key(x: number, y: number) {
  return `${x},${y}`
}

/**
 * Breadth-first search across walkable (land) tiles. Returns the full path
 * from `from` to `to`, exclusive of `from`. If `to` itself is not walkable
 * (e.g. the player clicked a water tile or the fishing spot), we instead
 * path to the closest walkable neighbour of `to`, which matches how RuneScape
 * resolves "move next to" intents.
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
  // neighbour so the player at least walks up to the shoreline.
  let target = to
  if (!walkable(to)) {
    const neighbours: Position[] = [
      { x: to.x - 1, y: to.y },
      { x: to.x + 1, y: to.y },
      { x: to.x, y: to.y - 1 },
      { x: to.x, y: to.y + 1 },
    ].filter(walkable)
    if (neighbours.length === 0) {
      return []
    }
    neighbours.sort(
      (a, b) =>
        Math.abs(a.x - from.x) + Math.abs(a.y - from.y) -
        (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)),
    )
    target = neighbours[0]
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
    const candidates: Position[] = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
    ]
    for (const next of candidates) {
      if (!walkable(next)) {
        continue
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
