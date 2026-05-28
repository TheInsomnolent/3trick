import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { advanceAlongPath, findPath } from './movement'
import type {
  GridDimensions,
  Position,
  SpotSpawnRule,
  TerrainGetter,
} from './types'
import { pickSpawnTile } from './terrain'

const TILE_PX = 36
// Viewport (in tiles) that is centered on the player.
const VIEW_TILES_W = 11
const VIEW_TILES_H = 9

interface GridSimProps {
  width: number
  height: number
  terrain: TerrainGetter
  spawnRule: SpotSpawnRule
  /** Initial player position; the player is "snapped" to this on mount. */
  initialPlayer: Position
  /** Player movement speed (tiles per tick). */
  tilesPerTick: number
  /** Tick interval in ms (the sim drives movement off this). */
  tickMs: number
  /** Pause movement and respawns (e.g. when the trainer isn't running). */
  paused?: boolean
  /** Interval, in ms, between random spot respawns. */
  respawnMs?: number
  /** Called when the active spot tile is clicked. */
  onSpotClick: () => void
}

export function GridSim({
  width,
  height,
  terrain,
  spawnRule,
  initialPlayer,
  tilesPerTick,
  tickMs,
  paused = false,
  respawnMs = 10_000,
  onSpotClick,
}: GridSimProps) {
  const dims: GridDimensions = useMemo(() => ({ width, height }), [width, height])

  const [player, setPlayer] = useState<Position>(initialPlayer)
  const [path, setPath] = useState<Position[]>([])
  const [spot, setSpot] = useState<Position | null>(() =>
    pickSpawnTile(dims, terrain, spawnRule, null),
  )

  // Keep a path ref so the tick loop reads the freshest path without
  // re-subscribing every render.
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  }, [path])

  // Drive player movement at the tick cadence.
  useEffect(() => {
    if (paused) {
      return
    }
    const timer = window.setInterval(() => {
      const currentPath = pathRef.current
      if (currentPath.length === 0) {
        return
      }
      setPlayer((current) => {
        const { position, remaining } = advanceAlongPath(
          current,
          currentPath,
          tilesPerTick,
        )
        pathRef.current = remaining
        setPath(remaining)
        return position
      })
    }, tickMs)
    return () => window.clearInterval(timer)
  }, [paused, tickMs, tilesPerTick])

  // Periodically respawn the skill spot.
  useEffect(() => {
    if (paused) {
      return
    }
    const timer = window.setInterval(() => {
      setSpot((prev) => pickSpawnTile(dims, terrain, spawnRule, prev))
    }, respawnMs)
    return () => window.clearInterval(timer)
  }, [paused, dims, terrain, spawnRule, respawnMs])

  const handleTileClick = useCallback(
    (x: number, y: number) => {
      if (spot && spot.x === x && spot.y === y) {
        onSpotClick()
        // After interacting with the spot, walk up to it (resolves to the
        // nearest walkable neighbour for water spots).
        setPath(findPath(player, { x, y }, dims, terrain))
        return
      }
      if (terrain(x, y) !== 'land') {
        // Can't path onto water for plain "walk here" clicks.
        return
      }
      setPath(findPath(player, { x, y }, dims, terrain))
    },
    [spot, onSpotClick, dims, terrain, player],
  )

  // Translate the grid so the player tile sits at the viewport's center.
  const viewportWidth = VIEW_TILES_W * TILE_PX
  const viewportHeight = VIEW_TILES_H * TILE_PX
  const offsetX = viewportWidth / 2 - (player.x + 0.5) * TILE_PX
  const offsetY = viewportHeight / 2 - (player.y + 0.5) * TILE_PX

  return (
    <div
      className="grid-viewport"
      style={{ width: viewportWidth, height: viewportHeight }}
    >
      <div
        className="grid"
        role="grid"
        style={{
          gridTemplateColumns: `repeat(${width}, ${TILE_PX}px)`,
          gridAutoRows: `${TILE_PX}px`,
          transform: `translate(${offsetX}px, ${offsetY}px)`,
        }}
      >
        {Array.from({ length: height }).flatMap((_, y) =>
          Array.from({ length: width }).map((__, x) => {
            const isSpot = spot ? spot.x === x && spot.y === y : false
            const isPlayer = player.x === x && player.y === y
            const t = terrain(x, y)
            const classes = [
              'tile',
              t === 'water' ? 'water' : 'land',
              isSpot ? 'active-spot' : '',
              isPlayer ? 'player' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                className={classes}
                onClick={() => handleTileClick(x, y)}
              >
                {isPlayer ? '★' : ''}
              </button>
            )
          }),
        )}
      </div>
    </div>
  )
}
