import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RunStats } from '../components/RunStats'
import { TrainerControls } from '../components/TrainerControls'
import { TrainerHeader } from '../components/TrainerHeader'
import { VisualMetronome } from '../components/VisualMetronome'
import { useTickEngine } from '../hooks/useTickEngine'
import { GridSim } from '../sim/GridSim'
import { fishingSpotOnShoreline, splitWaterRight } from '../sim/terrain'
import { BASE_TICK_MS, clamp, segmentProgress } from '../utils'
import { findTrainer } from './registry'
import type { ActionDefinition } from './types'

type ActionId = 'drop' | 'paste' | 'herb' | 'spot'

const TRAINER_ID = 'threeTickFishingDrop'
const GRID_WIDTH = 20
const GRID_HEIGHT = 14
const STURGEON_DROP_CHANCE = 0.3
// Sturgeon is added to the inventory three ticks after the spot click.
const STURGEON_DELAY_TICKS = 3
const STURGEON_ICON = 'https://static.runelite.net/cache/item/icon/331.png'

const ACTIONS: Record<ActionId, ActionDefinition> = {
  drop: {
    label: 'Shift-click sturgeon',
    icon: STURGEON_ICON,
    description: 'Shift-click the sturgeon in your inventory to drop it.',
  },
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

interface ThreeTickFishingDropTrainerProps {
  onBack: () => void
}

interface InventoryPosition {
  right: number
  bottom: number
}

export function ThreeTickFishingDropTrainer({ onBack }: ThreeTickFishingDropTrainerProps) {
  const trainerMeta = findTrainer(TRAINER_ID)

  const [speedSlider, setSpeedSlider] = useState(1)
  const [volume, setVolume] = useState(0.7)
  const [visualVisibility, setVisualVisibility] = useState(1)
  const [autoScale, setAutoScale] = useState(true)
  const [selectedSlot, setSelectedSlot] = useState<ActionId | null>(null)
  const [inventoryPos, setInventoryPos] = useState<InventoryPosition>({ right: 8, bottom: 8 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffsetRef = useRef<{ pointerX: number; pointerY: number; right: number; bottom: number } | null>(null)

  // Sturgeon inventory state. We track whether the player currently holds a
  // sturgeon (which makes the drop tick required) and any pending arrival
  // ticks (so we can grant sturgeon exactly STURGEON_DELAY_TICKS after the
  // matching spot click).
  const [hasSturgeon, setHasSturgeon] = useState(false)
  const pendingArrivalsRef = useRef<number[]>([])

  const terrain = useMemo(() => splitWaterRight(GRID_WIDTH), [])

  // The pattern is dynamic: tick 1 only requires "drop" when the player is
  // actually holding a sturgeon. Tick 2 requires paste *and* herb on the
  // same tick. Tick 3 is the fishing spot click.
  const pattern = useMemo<ActionId[][]>(
    () => [hasSturgeon ? ['drop'] : [], ['paste', 'herb'], ['spot']],
    [hasSturgeon],
  )

  const [engineInputs, setEngineInputs] = useState({
    tickMs: BASE_TICK_MS,
    tickOneVolume: 0.7,
    otherTickVolume: 0.7,
  })

  // Only count tick cycles while the player is actively harvesting (see
  // ThreeTickFishingTrainer for the same gating pattern).
  const [harvesting, setHarvesting] = useState(false)

  const engine = useTickEngine<ActionId>({
    trainerId: TRAINER_ID,
    pattern,
    tickMs: engineInputs.tickMs,
    tickOneVolume: engineInputs.tickOneVolume,
    otherTickVolume: engineInputs.otherTickVolume,
    paused: !harvesting,
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

  // Reset sturgeon bookkeeping whenever a run starts/stops so a previous
  // attempt doesn't leave the player erroneously holding fish (or expecting
  // a delivery on tick 3 of the new run). Done during render to mirror the
  // pattern used by ThreeTickFishingTrainer for engineInputs/selectedSlot.
  const [trackedActive, setTrackedActive] = useState(engine.active)
  if (trackedActive !== engine.active) {
    setTrackedActive(engine.active)
    if (!engine.active) {
      setSelectedSlot(null)
      setHasSturgeon(false)
    }
  }
  useEffect(() => {
    if (!engine.active) {
      pendingArrivalsRef.current = []
    }
  }, [engine.active])

  // Resolve sturgeon arrivals at each tick boundary. The engine's currentTick
  // monotonically increases while running, so consuming any pending arrivals
  // <= currentTick is enough to grant the fish at the right moment.
  useEffect(() => {
    if (!engine.isRunning) {
      return
    }
    const pending = pendingArrivalsRef.current
    if (pending.length === 0) {
      return
    }
    const due = pending.filter((t) => t <= engine.currentTick)
    if (due.length === 0) {
      return
    }
    pendingArrivalsRef.current = pending.filter((t) => t > engine.currentTick)
    setHasSturgeon(true)
  }, [engine.currentTick, engine.isRunning])

  const handleSpotClick = useCallback(() => {
    engine.handleAction('spot')
    if (Math.random() < STURGEON_DROP_CHANCE) {
      pendingArrivalsRef.current = [
        ...pendingArrivalsRef.current,
        engine.currentTick + STURGEON_DELAY_TICKS,
      ]
    }
  }, [engine])

  const handleInventoryItemClick = useCallback(
    (action: ActionId, event: React.MouseEvent<HTMLButtonElement>) => {
      // Alt+click is reserved for dragging the inventory panel.
      if (event.altKey) {
        return
      }
      if (action === 'drop') {
        // Drop is a shift-click only interaction; ignore plain clicks so the
        // player can't accidentally drop the fish.
        if (!event.shiftKey) {
          return
        }
        if (!hasSturgeon) {
          return
        }
        engine.handleAction('drop')
        setHasSturgeon(false)
        return
      }
      engine.handleAction(action)
      if (action === 'paste') {
        setSelectedSlot((prev) => (prev === 'paste' ? null : 'paste'))
      } else if (action === 'herb') {
        setSelectedSlot(null)
      }
    },
    [engine, hasSturgeon],
  )

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
    const text = `My best ${trainerMeta?.name ?? '3-tick fishing w/ drop'} streak is ${engine.bestStreak} ticks on 3trick!`

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
    <main className="trainer-screen">
      <TrainerHeader
        title="3-tick fishing w/ dropping fish"
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
        pattern={pattern}
        currentTick={engine.currentTick}
        isRunning={engine.isRunning}
        tickStatuses={engine.tickStatuses}
        visibility={effectiveVisual}
        actions={ACTIONS}
      />

      <section className="arena" aria-label="Fishing arena">
        <GridSim
          width={GRID_WIDTH}
          height={GRID_HEIGHT}
          terrain={terrain}
          spawnRule={fishingSpotOnShoreline}
          initialPlayer={{ x: Math.floor(GRID_WIDTH / 2) - 1, y: Math.floor(GRID_HEIGHT / 2) }}
          tilesPerTick={2}
          tickMs={tickMs}
          paused={!engine.active}
          onSpotClick={handleSpotClick}
          onHarvestingChange={setHarvesting}
        />

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

              if (index === 2 && hasSturgeon) {
                return (
                  <button
                    key={index}
                    type="button"
                    className="slot item sturgeon"
                    title="Shift-click to drop"
                    onClick={(event) => handleInventoryItemClick('drop', event)}
                  >
                    <img src={STURGEON_ICON} alt="Sturgeon" />
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
