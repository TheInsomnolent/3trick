export type TerrainType = 'land' | 'water'

export interface Position {
  x: number
  y: number
}

export interface GridDimensions {
  width: number
  height: number
}

/**
 * Pluggable terrain layout. Other sims can supply different layouts
 * (e.g. open ground for hunter, mixed islands, etc.).
 */
export type TerrainGetter = (x: number, y: number) => TerrainType

/**
 * Pluggable spawn rule that decides which tiles are valid for a skill spot.
 * Returning false means the spot will never spawn on that tile. Spawn picks
 * uniformly at random from the tiles that pass the predicate.
 */
export type SpotSpawnRule = (
  x: number,
  y: number,
  terrain: TerrainGetter,
  dims: GridDimensions,
) => boolean
