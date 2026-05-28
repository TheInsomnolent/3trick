import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { advanceAlongPath, findPath } from './movement'
import type {
  GridDimensions,
  Position,
  SpotSpawnRule,
  TerrainGetter,
} from './types'
import { pickSpawnTile } from './terrain'

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
}

interface CameraState {
  /** Pitch in Jagex units (PITCH_MIN_JAGEX..PITCH_MAX_JAGEX). */
  pitch: number
  /** Yaw in Jagex units (0..2048, unconstrained / wraps). */
  yaw: number
  /** Camera radius in tile units (ZOOM_MIN..ZOOM_MAX). */
  zoom: number
}

interface PlayerTickState {
  prev: Position
  current: Position
  startedAt: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Updates the camera each frame using the OSRS spherical view-matrix math. */
function OSRSCameraRig({
  targetRef,
  cameraStateRef,
}: {
  targetRef: React.MutableRefObject<THREE.Vector3>
  cameraStateRef: React.MutableRefObject<CameraState>
}) {
  useFrame((state) => {
    const cs = cameraStateRef.current
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
 * hit point to the integer tile under it.
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
 * Player mesh. Decoupled from React state: reads the logical position from
 * refs and lerps between the previous and current tile over `tickMs`.
 * Also writes its current world position into `targetRef` so the camera rig
 * can orbit the rendered (interpolated) torso position.
 */
function PlayerMesh({
  tickStateRef,
  tickMsRef,
  targetRef,
}: {
  tickStateRef: React.MutableRefObject<PlayerTickState>
  tickMsRef: React.MutableRefObject<number>
  targetRef: React.MutableRefObject<THREE.Vector3>
}) {
  const meshRef = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    // Note: grid Position uses (x, y) but in our right-handed Y-up scene the
    // grid lies on the XZ plane, so Position.y is the world Z axis.
    const { prev, current, startedAt } = tickStateRef.current
    const dur = Math.max(1, tickMsRef.current)
    const t = clamp((performance.now() - startedAt) / dur, 0, 1)
    const x = prev.x + (current.x - prev.x) * t + 0.5
    const z = prev.y + (current.y - prev.y) * t + 0.5
    meshRef.current.position.set(x, PLAYER_HEIGHT / 2, z)
    targetRef.current.set(x, 0, z)
  })
  return (
    <mesh ref={meshRef} castShadow>
      <boxGeometry args={[0.6, PLAYER_HEIGHT, 0.6]} />
      <meshStandardMaterial color="#f6cb6a" />
    </mesh>
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
}: GridSimProps) {
  const dims: GridDimensions = useMemo(() => ({ width, height }), [width, height])

  const [player, setPlayer] = useState<Position>(initialPlayer)
  const [path, setPath] = useState<Position[]>([])
  const [spot, setSpot] = useState<Position | null>(() =>
    pickSpawnTile(dims, terrain, spawnRule, null),
  )

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

  // Player tick state: previous tile, current tile, and the time the
  // transition began. PlayerMesh lerps between them in useFrame.
  const tickStateRef = useRef<PlayerTickState>({
    prev: initialPlayer,
    current: initialPlayer,
    startedAt: 0,
  })
  // tickMs can change with difficulty; keep an up-to-date ref for useFrame.
  const tickMsRef = useRef(tickMs)
  useEffect(() => {
    tickMsRef.current = tickMs
  }, [tickMs])

  // Whenever the logical player tile updates, push the prior tile + start
  // time into the tick state so the mesh smoothly lerps over `tickMs`.
  useEffect(() => {
    tickStateRef.current = {
      prev: tickStateRef.current.current,
      current: player,
      startedAt: performance.now(),
    }
  }, [player])

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

  const handleTilePicked = useCallback(
    (x: number, y: number) => {
      // Acceptance criterion: clicking the ground logs an integer-snapped target.
      console.log(`[3trick] move target -> (${x}, ${y})`)
      if (spot && spot.x === x && spot.y === y) {
        onSpotClick()
        setPath(findPath(player, { x, y }, dims, terrain))
        return
      }
      if (terrain(x, y) !== 'land') {
        return
      }
      setPath(findPath(player, { x, y }, dims, terrain))
    },
    [spot, onSpotClick, dims, terrain, player],
  )

  // --- Camera input: middle-mouse orbit + scroll-wheel zoom. ---
  const containerRef = useRef<HTMLDivElement>(null)
  const orbitStateRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return // middle mouse only
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={onAuxClick}
      onContextMenu={(e) => e.preventDefault()}
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
        <PlayerMesh
          tickStateRef={tickStateRef}
          tickMsRef={tickMsRef}
          targetRef={cameraTargetRef}
        />
        <MockEntity tileA={{ x: 1, y: 1 }} tileB={{ x: 4, y: 1 }} />
        <ClickPlane width={width} height={height} onTilePicked={handleTilePicked} />
        <OSRSCameraRig targetRef={cameraTargetRef} cameraStateRef={cameraStateRef} />
      </Canvas>
    </div>
  )
}
