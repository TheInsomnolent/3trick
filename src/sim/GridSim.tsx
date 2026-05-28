import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { findPath } from './movement'
import type {
  GridDimensions,
  Position,
  SpotSpawnRule,
  TerrainGetter,
} from './types'
import { pickSpawnTile } from './terrain'
import playerFbxUrl from '../assets/Default_OSRS_Model.fbx?url'

// --- OSRS 3D world constants (see Improvements Batch 4 spec) ---
// 1 unit = 1 OSRS tile. Jagex coords are 128 units per tile.
const TILE_SIZE_JAGEX = 128
// Jagex's circle is 2048 units == 2*PI radians.
const JAGEX_TO_RAD = (2 * Math.PI) / 2048
// Player visual height in tile units.
const PLAYER_HEIGHT = 1.6
// Camera looks at the player's torso (64 Jagex units == 0.5 tile units) above
// the feet so it orbits the body instead of the floor.
const TORSO_Y_OFFSET = 64 / TILE_SIZE_JAGEX

// Pitch is constrained from 22.5° (~ground level) to 90° (straight down).
// In Jagex's 2048-unit circle that's 128..512.
const PITCH_MIN_JAGEX = 128
const PITCH_MAX_JAGEX = 512
// Zoom is a radius in tile units; FOV stays fixed per spec.
const ZOOM_MIN = 3
const ZOOM_MAX = 25

// Arrow keys held in the viewport rotate the camera around the player; we
// track them in a Set keyed by KeyboardEvent.key so the camera rig can
// apply continuous rotation per frame.
const ARROW_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
])

const DEFAULT_PITCH_JAGEX = 280
const DEFAULT_YAW_JAGEX = 0
const DEFAULT_ZOOM = 12
const CAMERA_FOV = 45

// Viewport size of the canvas (in CSS pixels).
const VIEW_WIDTH = 720
const VIEW_HEIGHT = 480

// The mock entity (acceptance criteria) must interpolate between two integer
// tiles over EXACTLY 600ms regardless of trainer tick speed.
const MOCK_TICK_MS = 600

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
  /**
   * Called when the player's "harvesting" state changes. The player is
   * harvesting when they are orthogonally adjacent to the currently-active
   * spot AND that spot is the user's current interaction target (i.e. they
   * clicked the spot to walk to it).
   */
  onHarvestingChange?: (harvesting: boolean) => void
}

interface CameraState {
  /** Pitch in Jagex units (PITCH_MIN_JAGEX..PITCH_MAX_JAGEX). */
  pitch: number
  /** Yaw in Jagex units (0..2048, unconstrained / wraps). */
  yaw: number
  /** Camera radius in tile units (ZOOM_MIN..ZOOM_MAX). */
  zoom: number
}

interface PlayerSegment {
  from: Position
  to: Position
  /** Absolute performance.now() time, in ms, at which this segment starts. */
  startMs: number
  /** Segment duration in ms (== tickMs / tilesPerTick of the originating tick). */
  durMs: number
}

interface PlayerTickState {
  /** Most recent tile the player came to rest on (when no segments are queued). */
  rest: Position
  /** FIFO queue of in-flight movement segments. */
  segments: PlayerSegment[]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Updates the camera each frame using the OSRS spherical view-matrix math. */
function OSRSCameraRig({
  targetRef,
  cameraStateRef,
  arrowKeysRef,
}: {
  targetRef: React.MutableRefObject<THREE.Vector3>
  cameraStateRef: React.MutableRefObject<CameraState>
  arrowKeysRef: React.MutableRefObject<Set<string>>
}) {
  useFrame((state, delta) => {
    const cs = cameraStateRef.current

    // Smooth, continuous arrow-key camera rotation. Speeds are in Jagex
    // units per second so they feel snappy at any framerate. 720 Jagex
    // units/s ≈ 126°/s yaw and 480 ≈ 84°/s pitch.
    const keys = arrowKeysRef.current
    if (keys.size > 0) {
      const yawSpeed = 720 * delta
      const pitchSpeed = 480 * delta
      if (keys.has('ArrowLeft')) cs.yaw += yawSpeed
      if (keys.has('ArrowRight')) cs.yaw -= yawSpeed
      if (keys.has('ArrowUp')) cs.pitch -= pitchSpeed
      if (keys.has('ArrowDown')) cs.pitch += pitchSpeed
      cs.yaw = ((cs.yaw % 2048) + 2048) % 2048
      cs.pitch = clamp(cs.pitch, PITCH_MIN_JAGEX, PITCH_MAX_JAGEX)
    }

    const theta = cs.pitch * JAGEX_TO_RAD
    const phi = cs.yaw * JAGEX_TO_RAD

    const tx = targetRef.current.x
    const ty = targetRef.current.y + TORSO_Y_OFFSET
    const tz = targetRef.current.z

    const r = cs.zoom
    const cx = tx + r * Math.cos(theta) * Math.sin(phi)
    const cy = ty + r * Math.sin(theta)
    const cz = tz + r * Math.cos(theta) * Math.cos(phi)

    state.camera.position.set(cx, cy, cz)
    state.camera.lookAt(tx, ty, tz)
    state.camera.updateMatrixWorld()
  })
  return null
}

/** Renders each terrain tile as a 1x1 quad (land or water coloured). */
function TerrainTiles({
  width,
  height,
  terrain,
}: {
  width: number
  height: number
  terrain: TerrainGetter
}) {
  const tiles = useMemo(() => {
    const arr: { x: number; y: number; water: boolean }[] = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        arr.push({ x, y, water: terrain(x, y) === 'water' })
      }
    }
    return arr
  }, [width, height, terrain])

  return (
    <group>
      {tiles.map(({ x, y, water }) => (
        <mesh
          key={`${x}-${y}`}
          position={[x + 0.5, 0, y + 0.5]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[0.98, 0.98]} />
          <meshStandardMaterial color={water ? '#225696' : '#1f4e2f'} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Transparent ground plane covering the whole grid. Used as a single click
 * target so we can raycast the camera ray to the ground (Y=0) and snap the
 * hit point to the integer tile under it. Alt+left clicks are ignored so
 * the surrounding container can use them to orbit the camera.
 */
function ClickPlane({
  width,
  height,
  onTilePicked,
}: {
  width: number
  height: number
  onTilePicked: (x: number, y: number) => void
}) {
  const handle = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (event.nativeEvent.button !== 0) return
      if (event.nativeEvent.altKey) return // alt+left-click is camera orbit
      event.stopPropagation()
      // Snap hit point to the integer 1x1 grid (Math.floor per spec).
      const x = Math.floor(event.point.x)
      const z = Math.floor(event.point.z)
      if (x < 0 || x >= width || z < 0 || z >= height) return
      onTilePicked(x, z)
    },
    [width, height, onTilePicked],
  )
  return (
    <mesh
      position={[width / 2, -0.001, height / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={handle}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial visible={false} transparent opacity={0} />
    </mesh>
  )
}

/**
 * Advances the tick state up to the given timestamp, dropping any segments
 * whose end time has passed and updating the resting tile. Returns the
 * current visual position (in tile space, including the +0.5 centering) and
 * the desired facing yaw if the player is in motion. Shared between the
 * FBX-backed PlayerMesh and its loading fallback.
 */
function readTickStateAt(
  tickState: PlayerTickState,
  now: number,
): { px: number; pz: number; desiredYaw: number | null } {
  const segments = tickState.segments
  while (segments.length > 0 && segments[0].startMs + segments[0].durMs <= now) {
    const done = segments.shift()!
    tickState.rest = done.to
  }
  if (segments.length === 0) {
    return {
      px: tickState.rest.x + 0.5,
      pz: tickState.rest.y + 0.5,
      desiredYaw: null,
    }
  }
  const seg = segments[0]
  const t = now < seg.startMs ? 0 : clamp((now - seg.startMs) / seg.durMs, 0, 1)
  const px = seg.from.x + (seg.to.x - seg.from.x) * t + 0.5
  const pz = seg.from.y + (seg.to.y - seg.from.y) * t + 0.5
  const dx = seg.to.x - seg.from.x
  const dz = seg.to.y - seg.from.y
  const desiredYaw = dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : null
  return { px, pz, desiredYaw }
}

/**
 * Player model. Decoupled from React state: reads the queued movement
 * segments from a ref and advances tile-by-tile, so multi-tile ticks
 * (running) animate through every intermediate tile instead of cutting a
 * diagonal across them. Also writes its current world position into
 * `targetRef` so the camera rig can orbit the rendered torso position.
 *
 * The visible model is the "Default OSRS Model" FBX (see attribution in the
 * menu screen). Loaded lazily so the rest of the scene can render while the
 * mesh is fetched / parsed.
 */
function PlayerMesh({
  tickStateRef,
  targetRef,
}: {
  tickStateRef: React.MutableRefObject<PlayerTickState>
  targetRef: React.MutableRefObject<THREE.Vector3>
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const fbx = useLoader(FBXLoader, playerFbxUrl)

  // Clone the loaded scene so multiple GridSim instances don't share GPU
  // resources, and scale it so the model is exactly PLAYER_HEIGHT tall with
  // its feet on the ground (y = 0 in local space).
  const model = useMemo(() => {
    const cloned = fbx.clone(true)
    const rawBox = new THREE.Box3().setFromObject(cloned)
    const size = new THREE.Vector3()
    rawBox.getSize(size)
    const scale = size.y > 0 ? PLAYER_HEIGHT / size.y : 1
    cloned.scale.setScalar(scale)
    const scaledBox = new THREE.Box3().setFromObject(cloned)
    cloned.position.y = -scaledBox.min.y
    cloned.traverse((obj) => {
      const m = obj as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = false
      }
    })
    return cloned
  }, [fbx])

  // Smoothly rotate the model to face its current motion direction.
  const facingYawRef = useRef(0)

  useFrame((_, delta) => {
    const { px, pz, desiredYaw } = readTickStateAt(
      tickStateRef.current,
      performance.now(),
    )

    // Critically-damped-ish yaw smoothing toward the desired direction.
    if (desiredYaw !== null) {
      let diff = desiredYaw - facingYawRef.current
      while (diff > Math.PI) diff -= 2 * Math.PI
      while (diff < -Math.PI) diff += 2 * Math.PI
      const lerpAmount = clamp(delta * 12, 0, 1)
      facingYawRef.current += diff * lerpAmount
    }

    groupRef.current.position.set(px, 0, pz)
    groupRef.current.rotation.y = facingYawRef.current
    targetRef.current.set(px, 0, pz)
  })

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  )
}

/** Placeholder rendered while the FBX model is still loading. */
function PlayerMeshFallback({
  tickStateRef,
  targetRef,
}: {
  tickStateRef: React.MutableRefObject<PlayerTickState>
  targetRef: React.MutableRefObject<THREE.Vector3>
}) {
  const meshRef = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const { px, pz } = readTickStateAt(tickStateRef.current, performance.now())
    meshRef.current.position.set(px, PLAYER_HEIGHT / 2, pz)
    targetRef.current.set(px, 0, pz)
  })
  return (
    <mesh ref={meshRef} castShadow>
      <boxGeometry args={[0.6, PLAYER_HEIGHT, 0.6]} />
      <meshStandardMaterial color="#f6cb6a" />
    </mesh>
  )
}

/**
 * Highlights the player's "true tile" — the logical tile the game considers
 * the player to be on, which can be up to 1 game tick (walking) or 2 game
 * ticks (running) ahead of the visible model. Drawn as a translucent white
 * outline on top of the terrain, matching the OSRS "True tile" overlay.
 */
function TrueTileMarker({ tile }: { tile: Position }) {
  return (
    <group position={[tile.x + 0.5, 0.04, tile.y + 0.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.96, 0.96]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
      <lineSegments rotation={[-Math.PI / 2, 0, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(0.96, 0.96)]} />
        <lineBasicMaterial color="#ffffff" />
      </lineSegments>
    </group>
  )
}

/**
 * Mock entity demonstrating decoupled-from-state interpolation: ping-pongs
 * between two fixed integer tiles, completing each leg in EXACTLY 600ms.
 */
function MockEntity({ tileA, tileB }: { tileA: Position; tileB: Position }) {
  const meshRef = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const now = performance.now()
    const phase = (now % (MOCK_TICK_MS * 2)) / MOCK_TICK_MS // 0..2
    const t = phase <= 1 ? phase : 2 - phase
    const x = tileA.x + (tileB.x - tileA.x) * t + 0.5
    const z = tileA.y + (tileB.y - tileA.y) * t + 0.5
    meshRef.current.position.set(x, 0.3, z)
  })
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshStandardMaterial color="#ff6ad5" emissive="#5a1a44" />
    </mesh>
  )
}

/** Marker mesh rendered on top of the currently-active spot tile. */
function SpotMarker({ spot, water }: { spot: Position; water: boolean }) {
  return (
    <mesh
      position={[spot.x + 0.5, 0.05, spot.y + 0.5]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.35, 0.48, 24]} />
      <meshBasicMaterial color={water ? '#5fc7ff' : '#6be291'} side={THREE.DoubleSide} />
    </mesh>
  )
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
  onHarvestingChange,
}: GridSimProps) {
  const dims: GridDimensions = useMemo(() => ({ width, height }), [width, height])

  const [player, setPlayer] = useState<Position>(initialPlayer)
  const [path, setPath] = useState<Position[]>([])
  const [spot, setSpot] = useState<Position | null>(() =>
    pickSpawnTile(dims, terrain, spawnRule, null),
  )
  // Tile the user most-recently clicked the spot at. When this equals the
  // current spot AND the player is adjacent to it, the player is considered
  // "harvesting" (see onHarvestingChange).
  const [interactionSpot, setInteractionSpot] = useState<Position | null>(null)

  // Camera orbit/zoom state lives in a ref so input handlers can mutate it
  // every animation frame without re-rendering the React tree.
  const cameraStateRef = useRef<CameraState>({
    pitch: DEFAULT_PITCH_JAGEX,
    yaw: DEFAULT_YAW_JAGEX,
    zoom: DEFAULT_ZOOM,
  })
  // World-space target the camera orbits around (set each frame by PlayerMesh).
  const cameraTargetRef = useRef(
    new THREE.Vector3(initialPlayer.x + 0.5, 0, initialPlayer.y + 0.5),
  )

  // Player tick state: a queue of in-flight movement segments plus the tile
  // the model rests on when no segments are queued. PlayerMesh consumes the
  // queue in useFrame so movement runs decoupled from React renders.
  const tickStateRef = useRef<PlayerTickState>({
    rest: initialPlayer,
    segments: [],
  })
  // tickMs can change with difficulty; keep an up-to-date ref for the
  // movement loop closure.
  const tickMsRef = useRef(tickMs)
  useEffect(() => {
    tickMsRef.current = tickMs
  }, [tickMs])

  // Keep a path ref so the tick loop reads the freshest path without
  // re-subscribing every render.
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  }, [path])

  // Mirror player into a ref so the tick loop can read the latest tile
  // without needing the setter's updater callback (which StrictMode would
  // invoke twice, duplicating the visual segment push below).
  const playerRef = useRef(player)
  useEffect(() => {
    playerRef.current = player
  }, [player])

  // Drive player movement at the tick cadence. We intentionally DO NOT gate
  // this on `paused` so the player can wander around the grid before the
  // trainer starts (the trainer's tick engine is what `paused` reflects).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentPath = pathRef.current
      if (currentPath.length === 0) {
        return
      }
      // Compute everything synchronously here (outside setPlayer's updater)
      // so React StrictMode's double-invocation of the updater doesn't push
      // duplicate visual segments into the tick queue.
      const taken = Math.min(tilesPerTick, currentPath.length)
      const steps = currentPath.slice(0, taken)
      const remaining = currentPath.slice(taken)
      const newPosition = steps[steps.length - 1]
      const startTile = playerRef.current
      pathRef.current = remaining
      playerRef.current = newPosition
      setPath(remaining)
      setPlayer(newPosition)

      // Queue per-tile visual segments so multi-tile (running) ticks
      // animate through each intermediate tile instead of cutting a
      // diagonal across them. Each segment lasts tickMs/tilesPerTick, so
      // the model lags the true tile by ~1 tick when walking and up to
      // ~2 ticks when running — matching OSRS character-model behaviour.
      const ts = tickStateRef.current
      // Guard against pathological tilesPerTick / tickMs values producing
      // zero- or negative-duration segments (which would make the lerp NaN).
      const stepsPerTick = Math.max(1, tilesPerTick)
      const segDur = Math.max(1, tickMsRef.current / stepsPerTick)
      const now = performance.now()
      const lastSeg = ts.segments[ts.segments.length - 1]
      const lastEnd = lastSeg ? lastSeg.startMs + lastSeg.durMs : now
      // Chain new segments after any still-running ones so the model keeps
      // walking smoothly rather than jumping ahead.
      const baseStart = Math.max(now, lastEnd)
      let from = startTile
      for (let i = 0; i < steps.length; i += 1) {
        ts.segments.push({
          from,
          to: steps[i],
          startMs: baseStart + i * segDur,
          durMs: segDur,
        })
        from = steps[i]
      }
    }, tickMs)
    return () => window.clearInterval(timer)
  }, [tickMs, tilesPerTick])

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

  const handleTilePicked = useCallback(
    (x: number, y: number) => {
      // Acceptance criterion: clicking the ground logs an integer-snapped target.
      console.log(`[3trick] move target -> (${x}, ${y})`)
      if (spot && spot.x === x && spot.y === y) {
        // OSRS-style "use spot" intent: record the interaction target and
        // walk to the closest walkable tile adjacent to the spot (findPath
        // already retargets unwalkable destinations to a walkable neighbour).
        setInteractionSpot({ x, y })
        onSpotClick()
        setPath(findPath(player, { x, y }, dims, terrain))
        return
      }
      if (terrain(x, y) !== 'land') {
        return
      }
      // Walking somewhere else cancels any in-flight spot interaction so the
      // player stops "harvesting" the moment they choose to walk away.
      setInteractionSpot(null)
      setPath(findPath(player, { x, y }, dims, terrain))
    },
    [spot, onSpotClick, dims, terrain, player],
  )

  // Drop the interaction target if the spot it referred to is no longer the
  // active one (e.g. the spot respawned somewhere else). The player will need
  // to click the new spot to resume harvesting. Done during render (matching
  // the trackedActive pattern in the trainers) to avoid an effect that calls
  // setState synchronously.
  if (
    interactionSpot &&
    (!spot || spot.x !== interactionSpot.x || spot.y !== interactionSpot.y)
  ) {
    setInteractionSpot(null)
  }

  // Derive harvesting state: player is orthogonally adjacent to the active
  // spot AND that spot is the current interaction target. Notify the trainer
  // whenever it transitions so it can gate the tick engine.
  const harvesting =
    !!spot &&
    !!interactionSpot &&
    spot.x === interactionSpot.x &&
    spot.y === interactionSpot.y &&
    Math.abs(player.x - spot.x) + Math.abs(player.y - spot.y) === 1
  const lastHarvestingRef = useRef(false)
  useEffect(() => {
    if (lastHarvestingRef.current !== harvesting) {
      lastHarvestingRef.current = harvesting
      onHarvestingChange?.(harvesting)
    }
  }, [harvesting, onHarvestingChange])

  // --- Camera input: middle-mouse or alt+left orbit, scroll-wheel zoom,
  // and arrow-key tilt / pan. ---
  const containerRef = useRef<HTMLDivElement>(null)
  const orbitStateRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Middle mouse OR Alt + left mouse begins an orbit drag.
    const isMiddle = event.button === 1
    const isAltLeft = event.button === 0 && event.altKey
    if (!isMiddle && !isAltLeft) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    orbitStateRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const orbit = orbitStateRef.current
    if (!orbit || orbit.pointerId !== event.pointerId) return
    const dx = event.clientX - orbit.lastX
    const dy = event.clientY - orbit.lastY
    orbit.lastX = event.clientX
    orbit.lastY = event.clientY
    const cs = cameraStateRef.current
    // Drag right -> yaw right; drag up -> pitch toward overhead.
    cs.yaw = ((cs.yaw - dx * 2) % 2048 + 2048) % 2048
    cs.pitch = clamp(cs.pitch + dy * 1.5, PITCH_MIN_JAGEX, PITCH_MAX_JAGEX)
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const orbit = orbitStateRef.current
    if (!orbit || orbit.pointerId !== event.pointerId) return
    orbitStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  // Wheel must be attached non-passive so we can preventDefault the page scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (event: WheelEvent) => {
      event.preventDefault()
      const cs = cameraStateRef.current
      cs.zoom = clamp(cs.zoom + Math.sign(event.deltaY) * 1, ZOOM_MIN, ZOOM_MAX)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Arrow keys rotate the camera around the player. We track which arrow
  // keys are currently held in a Set and apply continuous angular velocity
  // each frame in the camera rig (see OSRSCameraRig). This decouples the
  // rotation from the OS key-repeat cadence, making it smooth and quicker
  // than per-keystroke jumps.
  const arrowKeysRef = useRef<Set<string>>(new Set())
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ARROW_KEYS.has(event.key)) return
      arrowKeysRef.current.add(event.key)
      event.preventDefault()
    },
    [],
  )
  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ARROW_KEYS.has(event.key)) return
      arrowKeysRef.current.delete(event.key)
      event.preventDefault()
    },
    [],
  )
  // Release any held keys if the viewport loses focus, otherwise the camera
  // would keep rotating after the user tabs away.
  const onBlur = useCallback(() => {
    arrowKeysRef.current.clear()
  }, [])

  // Suppress the browser autoscroll cursor that middle-click triggers.
  const onAuxClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) event.preventDefault()
  }, [])

  const spotIsWater = spot ? terrain(spot.x, spot.y) === 'water' : false

  return (
    <div
      ref={containerRef}
      className="grid-viewport"
      style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT, touchAction: 'none' }}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={onAuxClick}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
    >
      <Canvas
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 1000, position: [0, 10, 10] }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        {/* Three.js is right-handed and Y-up by default, which matches the spec. */}
        <color attach="background" args={['#0e2616']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 18, 6]} intensity={0.9} />
        <TerrainTiles width={width} height={height} terrain={terrain} />
        {spot && <SpotMarker spot={spot} water={spotIsWater} />}
        <TrueTileMarker tile={player} />
        <Suspense
          fallback={
            <PlayerMeshFallback
              tickStateRef={tickStateRef}
              targetRef={cameraTargetRef}
            />
          }
        >
          <PlayerMesh
            tickStateRef={tickStateRef}
            targetRef={cameraTargetRef}
          />
        </Suspense>
        <MockEntity tileA={{ x: 1, y: 1 }} tileB={{ x: 4, y: 1 }} />
        <ClickPlane width={width} height={height} onTilePicked={handleTilePicked} />
        <OSRSCameraRig
          targetRef={cameraTargetRef}
          cameraStateRef={cameraStateRef}
          arrowKeysRef={arrowKeysRef}
        />
      </Canvas>
    </div>
  )
}
