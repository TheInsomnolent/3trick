import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RunStats } from '../components/RunStats'
import { TrainerControls } from '../components/TrainerControls'
import { TrainerHeader } from '../components/TrainerHeader'
import { VisualMetronome } from '../components/VisualMetronome'
import { useTickEngine } from '../hooks/useTickEngine'
import { BASE_TICK_MS, clamp, segmentProgress } from '../utils'
import { findTrainer } from './registry'
import type { ActionDefinition } from './types'

type ActionId = 'paste' | 'herb' | 'spot'

const TRAINER_ID = 'threeTickFishing'
const GRID_WIDTH = 14
const GRID_HEIGHT = 10

const ACTIONS: Record<ActionId, ActionDefinition> = {
  paste: {
    label: 'Tap swamp paste',
    icon: 'https://static.runelite.net/cache/item/icon/1941.png',
    description: 'Select the swamp paste in your inventory.',
  },
  herb: {
    label: 'Use on herb',
    icon: 'https://static.runelite.net/cache/item/icon/249.png',
    description: 'Use the selected swamp paste on the guam leaf.',
  },
  spot: {
    label: 'Click fishing spot',
    icon: 'https://static.runelite.net/cache/item/icon/335.png',
    description: 'Click the active fishing tile.',
  },
}

const PATTERN: ActionId[][] = [['paste'], ['herb'], ['spot']]

function randomStep() {
  return Math.floor(Math.random() * 5) - 2
}

interface ThreeTickFishingTrainerProps {
  cursor?: string
  onBack: () => void
}

interface InventoryPosition {
  right: number
  bottom: number
}

export function ThreeTickFishingTrainer({ cursor, onBack }: ThreeTickFishingTrainerProps) {
  const trainerMeta = findTrainer(TRAINER_ID)

  const [speedSlider, setSpeedSlider] = useState(0.55)
  const [volume, setVolume] = useState(0.7)
  const [visualVisibility, setVisualVisibility] = useState(1)
  const [autoScale, setAutoScale] = useState(true)
  const [spot, setSpot] = useState({ x: 8, y: 4 })
  const [selectedSlot, setSelectedSlot] = useState<ActionId | null>(null)
  const [inventoryPos, setInventoryPos] = useState<InventoryPosition>({ right: 8, bottom: 8 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffsetRef = useRef<{ pointerX: number; pointerY: number; right: number; bottom: number } | null>(null)

  // Difficulty / tick speed / volumes are derived from the engine's current
  // streak. The engine takes tickMs as input, so updating streak naturally
  // restarts the engine's interval on the next render (same feedback loop
  // as before the refactor, when all of this lived in App.tsx).
  const [engineInputs, setEngineInputs] = useState({
    tickMs: BASE_TICK_MS / 0.55,
    tickOneVolume: 0.7,
    otherTickVolume: 0.7,
  })

  const engine = useTickEngine<ActionId>({
    trainerId: TRAINER_ID,
    pattern: PATTERN,
    tickMs: engineInputs.tickMs,
    tickOneVolume: engineInputs.tickOneVolume,
    otherTickVolume: engineInputs.otherTickVolume,
  })

  const difficulty = autoScale ? Math.min(1, engine.streak / 60) : 0
  const speedBoost = segmentProgress(difficulty, 0, 0.35)
  const otherTickFade = segmentProgress(difficulty, 0.35, 0.65)
  const visualFade = segmentProgress(difficulty, 0.65, 0.9)
  const firstTickFade = segmentProgress(difficulty, 0.9, 1)

  const tickSpeed = clamp(speedSlider + (1 - speedSlider) * speedBoost, 0.3, 1)
  const tickMs = BASE_TICK_MS / tickSpeed
  const effectiveVisual = clamp(visualVisibility * (1 - visualFade), 0, 1)
  const tickOneVolume = volume * (1 - firstTickFade)
  const otherTickVolume = volume * (1 - otherTickFade)

  if (
    engineInputs.tickMs !== tickMs ||
    engineInputs.tickOneVolume !== tickOneVolume ||
    engineInputs.otherTickVolume !== otherTickVolume
  ) {
    setEngineInputs({ tickMs, tickOneVolume, otherTickVolume })
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSpot((prev) => ({
        x: clamp(prev.x + randomStep(), 0, GRID_WIDTH - 1),
        y: clamp(prev.y + randomStep(), 0, GRID_HEIGHT - 1),
      }))
    }, 10000)

    return () => window.clearInterval(timer)
  }, [])

  const semiHighlightedTiles = useMemo(() => {
    const nearby = [
      { x: spot.x - 1, y: spot.y },
      { x: spot.x + 1, y: spot.y },
      { x: spot.x, y: spot.y - 1 },
      { x: spot.x, y: spot.y + 1 },
      { x: spot.x - 1, y: spot.y - 1 },
    ]

    return nearby.filter(
      ({ x, y }) => x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT,
    )
  }, [spot.x, spot.y])

  const handleInventoryItemClick = useCallback(
    (action: ActionId, event: React.MouseEvent<HTMLButtonElement>) => {
      // Alt+click is reserved for dragging the inventory panel.
      if (event.altKey) {
        return
      }
      engine.handleAction(action)
      // Mirror OSRS "selected item" indicator: clicking paste flags it, the
      // follow-up herb click consumes the selection.
      if (action === 'paste') {
        setSelectedSlot((prev) => (prev === 'paste' ? null : 'paste'))
      } else if (action === 'herb') {
        setSelectedSlot(null)
      }
    },
    [engine],
  )

  // Reset the selection indicator whenever a run starts/stops so stale state
  // from a previous attempt doesn't carry over visually. Done during render to
  // avoid a redundant effect (mirrors how engineInputs is reconciled above).
  const [trackedActive, setTrackedActive] = useState(engine.active)
  if (trackedActive !== engine.active) {
    setTrackedActive(engine.active)
    if (!engine.active) {
      setSelectedSlot(null)
    }
  }

  const handleInventoryPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.altKey) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      dragOffsetRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        right: inventoryPos.right,
        bottom: inventoryPos.bottom,
      }
      setIsDragging(true)
    },
    [inventoryPos.bottom, inventoryPos.right],
  )

  const handleInventoryPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = dragOffsetRef.current
      if (!start) {
        return
      }
      const dx = event.clientX - start.pointerX
      const dy = event.clientY - start.pointerY
      setInventoryPos({
        right: Math.max(0, start.right - dx),
        bottom: Math.max(0, start.bottom - dy),
      })
    },
    [],
  )

  const handleInventoryPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragOffsetRef.current) {
        return
      }
      dragOffsetRef.current = null
      setIsDragging(false)
      const target = event.currentTarget
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )

  const shareBest = async () => {
    const text = `My best ${trainerMeta?.name ?? '3-tick fishing'} streak is ${engine.bestStreak} ticks on 3trick!`

    try {
      if (navigator.share) {
        await navigator.share({
          title: '3trick streak',
          text,
          url: window.location.href,
        })
        return
      }

      await navigator.clipboard.writeText(`${text} ${window.location.href}`)
    } catch {
      return
    }
  }

  return (
    <main className="trainer-screen" style={cursor ? { cursor } : undefined}>
      <TrainerHeader
        title="3-tick fishing trainer"
        streak={engine.streak}
        bestStreak={engine.bestStreak}
        onBack={onBack}
      />

      <TrainerControls
        active={engine.active}
        countdown={engine.countdown}
        tickSpeed={tickSpeed}
        speedSlider={speedSlider}
        volume={volume}
        visualVisibility={visualVisibility}
        autoScale={autoScale}
        onStart={engine.startRun}
        onStop={engine.stopRun}
        onSpeedChange={setSpeedSlider}
        onVolumeChange={setVolume}
        onVisualVisibilityChange={setVisualVisibility}
        onAutoScaleChange={setAutoScale}
      />

      <VisualMetronome<ActionId>
        pattern={PATTERN}
        currentTick={engine.currentTick}
        isRunning={engine.isRunning}
        tickStatuses={engine.tickStatuses}
        visibility={effectiveVisual}
        actions={ACTIONS}
      />

      <section className="arena" aria-label="Fishing arena">
        <div className="grid" role="grid">
          {Array.from({ length: GRID_HEIGHT }).flatMap((_, y) =>
            Array.from({ length: GRID_WIDTH }).map((__, x) => {
              const isSpot = x === spot.x && y === spot.y
              const isSemi = semiHighlightedTiles.some((tile) => tile.x === x && tile.y === y)

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  className={`tile ${isSemi ? 'semi' : ''} ${isSpot ? 'active-spot' : ''}`}
                  onClick={() => isSpot && engine.handleAction('spot')}
                >
                  {isSpot ? 'Fishing spot' : ''}
                </button>
              )
            }),
          )}
        </div>

        <aside
          className={`inventory ${isDragging ? 'dragging' : ''}`}
          aria-label="Inventory"
          style={{ right: inventoryPos.right, bottom: inventoryPos.bottom }}
          onPointerDown={handleInventoryPointerDown}
          onPointerMove={handleInventoryPointerMove}
          onPointerUp={handleInventoryPointerUp}
          onPointerCancel={handleInventoryPointerUp}
        >
          <div className="inventory-title">Inventory (Alt+drag to move)</div>
          <div className="inventory-grid">
            {Array.from({ length: 28 }).map((_, index) => {
              if (index === 0) {
                return (
                  <button
                    key={index}
                    type="button"
                    className="slot item"
                    onClick={(event) => handleInventoryItemClick('herb', event)}
                  >
                    <img src="https://static.runelite.net/cache/item/icon/249.png" alt="Guam leaf" />
                  </button>
                )
              }

              if (index === 1) {
                return (
                  <button
                    key={index}
                    type="button"
                    className={`slot item ${selectedSlot === 'paste' ? 'selected' : ''}`}
                    onClick={(event) => handleInventoryItemClick('paste', event)}
                  >
                    <img src="https://static.runelite.net/cache/item/icon/1941.png" alt="Swamp paste" />
                  </button>
                )
              }

              return <div key={index} className="slot" />
            })}
          </div>
        </aside>
      </section>

      {engine.showStats && (
        <RunStats
          runTicks={engine.runTicks}
          runSuccesses={engine.runSuccesses}
          runFailures={engine.runFailures}
          onShare={() => void shareBest()}
        />
      )}
    </main>
  )
}
