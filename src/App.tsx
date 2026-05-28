import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { abyssalWhip, toDataUrl } from '@dava96/osrs-icons'
import './App.css'

type TrainerId = 'threeTickFishing' | 'twoTickTeaks' | 'onePointFiveT'
type ActionId = 'mix' | 'spot'
type TickStatus = 'pending' | 'success' | 'failed'

const BASE_TICK_MS = 600
const COUNT_IN_TICKS = 4
const GRID_WIDTH = 14
const GRID_HEIGHT = 10
const STORAGE_PREFIX = '3trick.best.'

const TRAINERS: { id: TrainerId; name: string; description: string; enabled: boolean }[] = [
  {
    id: 'threeTickFishing',
    name: '3-tick fishing',
    description: 'Practice herb-tar + fishing spot timing on true 0.6s OSRS ticks.',
    enabled: true,
  },
  {
    id: 'twoTickTeaks',
    name: '2-tick teaks',
    description: 'Coming soon',
    enabled: false,
  },
  {
    id: 'onePointFiveT',
    name: '1.5-tick hunter',
    description: 'Coming soon',
    enabled: false,
  },
]

const ACTIONS: Record<
  ActionId,
  { label: string; icon: string; description: string }
> = {
  mix: {
    label: 'Mix herb + tar',
    icon: 'https://static.runelite.net/cache/item/icon/249.png',
    description: 'Use guam leaf with swamp tar in the same tick.',
  },
  spot: {
    label: 'Click fishing spot',
    icon: 'https://static.runelite.net/cache/item/icon/335.png',
    description: 'Click the active fishing tile.',
  },
}

const PATTERN: ActionId[][] = [['mix', 'spot'], [], ['spot']]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function randomStep() {
  return Math.floor(Math.random() * 5) - 2
}

function segmentProgress(value: number, start: number, end: number) {
  if (value <= start) {
    return 0
  }

  if (value >= end) {
    return 1
  }

  return (value - start) / (end - start)
}

function readBestStreak(trainerId: TrainerId) {
  const saved = Number.parseInt(localStorage.getItem(`${STORAGE_PREFIX}${trainerId}`) ?? '0', 10)
  return Number.isFinite(saved) ? saved : 0
}

function App() {
  const [trainer, setTrainer] = useState<TrainerId | null>(null)
  const [active, setActive] = useState(false)
  const [heartbeats, setHeartbeats] = useState(0)
  const [speedSlider, setSpeedSlider] = useState(0.55)
  const [volume, setVolume] = useState(0.7)
  const [visualVisibility, setVisualVisibility] = useState(1)
  const [autoScale, setAutoScale] = useState(true)

  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [runTicks, setRunTicks] = useState(0)
  const [runSuccesses, setRunSuccesses] = useState(0)
  const [runFailures, setRunFailures] = useState(0)
  const [showStats, setShowStats] = useState(false)

  const [spot, setSpot] = useState({ x: 8, y: 4 })
  const [handledActions, setHandledActions] = useState<ActionId[]>([])
  const [tickStatuses, setTickStatuses] = useState<Record<string, TickStatus>>({})

  const audioContextRef = useRef<AudioContext | null>(null)
  const tickHasErrorRef = useRef(false)
  const handledActionsRef = useRef<ActionId[]>([])

  const countdown = active ? Math.max(0, COUNT_IN_TICKS - heartbeats) : 0
  const isRunning = active && countdown === 0
  const currentTick = isRunning ? heartbeats - COUNT_IN_TICKS : 0

  const difficulty = autoScale ? Math.min(1, streak / 60) : 0
  const speedBoost = segmentProgress(difficulty, 0, 0.35)
  const otherTickFade = segmentProgress(difficulty, 0.35, 0.65)
  const visualFade = segmentProgress(difficulty, 0.65, 0.9)
  const firstTickFade = segmentProgress(difficulty, 0.9, 1)

  const tickSpeed = clamp(speedSlider + (1 - speedSlider) * speedBoost, 0.3, 1)
  const tickMs = BASE_TICK_MS / tickSpeed
  const effectiveVisual = clamp(visualVisibility * (1 - visualFade), 0, 1)
  const tickOneVolume = volume * (1 - firstTickFade)
  const otherTickVolume = volume * (1 - otherTickFade)

  const requiredActions = PATTERN[currentTick % PATTERN.length] ?? []

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

  const osrsCursor = useMemo(() => `url(${toDataUrl(abyssalWhip)}) 2 2, auto`, [])

  useEffect(() => {
    if (!trainer) {
      return
    }

    const key = `${STORAGE_PREFIX}${trainer}`
    localStorage.setItem(key, String(bestStreak))
  }, [bestStreak, trainer])

  useEffect(() => {
    if (!trainer) {
      return
    }

    const timer = window.setInterval(() => {
      setSpot((prev) => ({
        x: clamp(prev.x + randomStep(), 0, GRID_WIDTH - 1),
        y: clamp(prev.y + randomStep(), 0, GRID_HEIGHT - 1),
      }))
    }, 10000)

    return () => window.clearInterval(timer)
  }, [trainer])

  useEffect(() => {
    handledActionsRef.current = handledActions
  }, [handledActions])

  const playTick = useCallback((isPrimary: boolean) => {
    const scopedVolume = isPrimary ? tickOneVolume : otherTickVolume
    if (scopedVolume <= 0) {
      return
    }

    const context =
      audioContextRef.current ?? new window.AudioContext({ latencyHint: 'interactive' })
    audioContextRef.current = context

    const osc = context.createOscillator()
    const gain = context.createGain()

    osc.type = 'square'
    osc.frequency.value = isPrimary ? 880 : 520
    gain.gain.value = scopedVolume * (isPrimary ? 0.22 : 0.18)

    osc.connect(gain)
    gain.connect(context.destination)

    const now = context.currentTime
    osc.start(now)
    osc.stop(now + 0.06)
  }, [otherTickVolume, tickOneVolume])

  useEffect(() => {
    if (!active) {
      return
    }

    const timer = window.setInterval(() => {
      setHeartbeats((ticks) => {
        const next = ticks + 1
        const nextCountdown = Math.max(0, COUNT_IN_TICKS - next)

        if (nextCountdown > 0) {
          playTick(true)
          return next
        }

        const nextTick = next - COUNT_IN_TICKS
        const tickInPattern = nextTick % PATTERN.length
        playTick(tickInPattern === 0)

        if (nextTick === 0) {
          setHandledActions([])
          tickHasErrorRef.current = false
          return next
        }

        const previousTick = nextTick - 1
        const previousRequired = PATTERN[previousTick % PATTERN.length] ?? []
        const done = new Set(handledActionsRef.current)

        let missed = false
        for (const action of previousRequired) {
          const key = `${previousTick}:${action}`
          if (!done.has(action)) {
            setTickStatuses((prev) => ({ ...prev, [key]: 'failed' }))
            missed = true
          }
        }

        const tickFailed = missed || tickHasErrorRef.current
        setRunTicks((prev) => prev + 1)

        if (tickFailed) {
          setStreak(0)
        } else {
          setStreak((prev) => {
            const nextStreak = prev + 1
            setBestStreak((best) => (nextStreak > best ? nextStreak : best))
            return nextStreak
          })
        }

        setHandledActions([])
        tickHasErrorRef.current = false
        return next
      })
    }, tickMs)

    return () => window.clearInterval(timer)
  }, [active, playTick, tickMs])

  const handleAction = (action: ActionId) => {
    if (!isRunning) {
      return
    }

    const key = `${currentTick}:${action}`

    if (!requiredActions.includes(action) || handledActions.includes(action)) {
      tickHasErrorRef.current = true
      setTickStatuses((prev) => ({ ...prev, [key]: 'failed' }))
      setRunFailures((prev) => prev + 1)
      return
    }

    setHandledActions((prev) => [...prev, action])
    setTickStatuses((prev) => ({ ...prev, [key]: 'success' }))
    setRunSuccesses((prev) => prev + 1)
  }

  const startRun = () => {
    setActive(true)
    setShowStats(false)
    setHeartbeats(0)
    setStreak(0)
    setRunTicks(0)
    setRunSuccesses(0)
    setRunFailures(0)
    setTickStatuses({})
    setHandledActions([])
    tickHasErrorRef.current = false
  }

  const stopRun = () => {
    if (isRunning) {
      const done = new Set(handledActions)
      const finalRequired = PATTERN[currentTick % PATTERN.length] ?? []
      const missed = finalRequired.some((action) => !done.has(action))
      const tickFailed = missed || tickHasErrorRef.current
      setRunTicks((prev) => prev + 1)
      if (!tickFailed) {
        setStreak((prev) => {
          const next = prev + 1
          setBestStreak((best) => (next > best ? next : best))
          return next
        })
      }
    }

    setActive(false)
    setShowStats(true)
    tickHasErrorRef.current = false
  }

  const shareBest = async () => {
    if (!trainer) {
      return
    }

    const text = `My best ${TRAINERS.find((item) => item.id === trainer)?.name} streak is ${bestStreak} ticks on 3trick!`

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

  if (!trainer) {
    return (
      <main className="menu-screen" style={{ cursor: osrsCursor }}>
        <h1>3trick training dojo</h1>
        <p className="menu-subtitle">Pick a trainer from common OSRS tick manipulation methods.</p>
        <section className="trainer-list" aria-label="Trainer methods">
          {TRAINERS.map((method) => (
            <button
              key={method.name}
              type="button"
              className="trainer-card"
              disabled={!method.enabled}
              onClick={() => {
                setTrainer(method.id)
                setBestStreak(readBestStreak(method.id))
              }}
            >
              <strong>{method.name}</strong>
              <span>{method.description}</span>
              {!method.enabled && <em>Unavailable</em>}
            </button>
          ))}
        </section>
      </main>
    )
  }

  return (
    <main className="trainer-screen" style={{ cursor: osrsCursor }}>
      <header className="top-bar">
        <button type="button" onClick={() => setTrainer(null)}>
          ← Menu
        </button>
        <h1>3-tick fishing trainer</h1>
        <div className="streak">Streak: {streak}</div>
        <div className="streak">Best: {bestStreak}</div>
      </header>

      <section className="controls">
        <button type="button" onClick={startRun} disabled={active}>
          {countdown > 0 ? `Count-in ${countdown}` : 'Start (4 tick count-in)'}
        </button>
        <button type="button" onClick={stopRun} disabled={!active}>
          Stop
        </button>

        <label>
          Tick speed {Math.round(tickSpeed * 100)}%
          <input
            type="range"
            min="0.3"
            max="1"
            step="0.01"
            value={speedSlider}
            onChange={(event) => setSpeedSlider(Number(event.target.value))}
          />
        </label>

        <label>
          Metronome volume {Math.round(volume * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>

        <label>
          Visual metronome {Math.round(visualVisibility * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={visualVisibility}
            onChange={(event) => setVisualVisibility(Number(event.target.value))}
          />
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={autoScale}
            onChange={(event) => setAutoScale(event.target.checked)}
          />
          Auto difficulty scaler
        </label>
      </section>

      <section className="visual-metronome" style={{ opacity: effectiveVisual }}>
        {PATTERN.map((tickActions, tickIndex) => (
          <div
            key={tickIndex}
            className={`metronome-tick ${tickIndex === currentTick % PATTERN.length && isRunning ? 'current' : ''}`}
          >
            <div className="tick-label">Tick {tickIndex + 1}</div>
            <div className="tick-actions">
              {tickActions.length === 0 && <span className="wait">Wait</span>}
              {tickActions.map((action) => {
                const key = `${currentTick}:${action}`
                const status = tickStatuses[key] ?? 'pending'
                return (
                  <div key={action} className={`tick-action ${status}`} title={ACTIONS[action].description}>
                    <img src={ACTIONS[action].icon} alt="" />
                    <span>{ACTIONS[action].label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>

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
                  onClick={() => isSpot && handleAction('spot')}
                >
                  {isSpot ? 'Fishing spot' : ''}
                </button>
              )
            }),
          )}
        </div>

        <aside className="inventory" aria-label="Inventory">
          <div className="inventory-title">Inventory</div>
          <div className="inventory-grid">
            {Array.from({ length: 28 }).map((_, index) => {
              if (index === 0) {
                return (
                  <button key={index} type="button" className="slot item" onClick={() => handleAction('mix')}>
                    <img src="https://static.runelite.net/cache/item/icon/249.png" alt="Guam leaf" />
                  </button>
                )
              }

              if (index === 1) {
                return (
                  <button key={index} type="button" className="slot item" onClick={() => handleAction('mix')}>
                    <img src="https://static.runelite.net/cache/item/icon/1939.png" alt="Swamp tar" />
                  </button>
                )
              }

              return <div key={index} className="slot" />
            })}
          </div>
        </aside>
      </section>

      {showStats && (
        <section className="stats" aria-live="polite">
          <h2>Run stats</h2>
          <p>Total ticks: {runTicks}</p>
          <p>Correct inputs: {runSuccesses}</p>
          <p>Failed inputs: {runFailures}</p>
          <p>
            Accuracy:{' '}
            {runSuccesses + runFailures > 0
              ? Math.round((runSuccesses / (runSuccesses + runFailures)) * 100)
              : 0}
            %
          </p>
          <button type="button" onClick={() => void shareBest()}>
            Share best streak
          </button>
        </section>
      )}
    </main>
  )
}

export default App
