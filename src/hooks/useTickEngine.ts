import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COUNT_IN_TICKS, STORAGE_PREFIX, readBestStreak } from '../utils'
import type { TickStatus, TrainerId } from '../trainers/types'

interface UseTickEngineOptions<ActionId extends string> {
  trainerId: TrainerId
  pattern: ActionId[][]
  tickMs: number
  tickOneVolume: number
  otherTickVolume: number
}

export interface TickEngine<ActionId extends string> {
  active: boolean
  isRunning: boolean
  countdown: number
  currentTick: number
  requiredActions: ActionId[]
  tickStatuses: Record<string, TickStatus>
  streak: number
  bestStreak: number
  runTicks: number
  runSuccesses: number
  runFailures: number
  showStats: boolean
  handleAction: (action: ActionId) => void
  startRun: () => void
  stopRun: () => void
}

export function useTickEngine<ActionId extends string>({
  trainerId,
  pattern,
  tickMs,
  tickOneVolume,
  otherTickVolume,
}: UseTickEngineOptions<ActionId>): TickEngine<ActionId> {
  const [active, setActive] = useState(false)
  const [heartbeats, setHeartbeats] = useState(0)

  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(() => readBestStreak(trainerId))
  const [runTicks, setRunTicks] = useState(0)
  const [runSuccesses, setRunSuccesses] = useState(0)
  const [runFailures, setRunFailures] = useState(0)
  const [showStats, setShowStats] = useState(false)

  const [handledActions, setHandledActions] = useState<ActionId[]>([])
  const [tickStatuses, setTickStatuses] = useState<Record<string, TickStatus>>({})

  const audioContextRef = useRef<AudioContext | null>(null)
  const tickHasErrorRef = useRef(false)
  const handledActionsRef = useRef<ActionId[]>([])
  const patternRef = useRef(pattern)

  useEffect(() => {
    patternRef.current = pattern
  }, [pattern])

  const countdown = active ? Math.max(0, COUNT_IN_TICKS - heartbeats) : 0
  const isRunning = active && countdown === 0
  const currentTick = isRunning ? heartbeats - COUNT_IN_TICKS : 0
  const requiredActions = useMemo(
    () => pattern[currentTick % pattern.length] ?? [],
    [pattern, currentTick],
  )

  useEffect(() => {
    const key = `${STORAGE_PREFIX}${trainerId}`
    localStorage.setItem(key, String(bestStreak))
  }, [bestStreak, trainerId])

  useEffect(() => {
    handledActionsRef.current = handledActions
  }, [handledActions])

  const playTick = useCallback(
    (isPrimary: boolean, intensity: number = 1) => {
      const baseVolume = isPrimary ? tickOneVolume : otherTickVolume
      const scopedVolume = baseVolume * intensity
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
    },
    [otherTickVolume, tickOneVolume],
  )

  const playTickRef = useRef(playTick)
  useEffect(() => {
    playTickRef.current = playTick
  }, [playTick])

  const scheduleSubticks = useCallback(
    (isPrimary: boolean, subtickCount: number) => {
      if (subtickCount <= 1) {
        return
      }
      const interval = tickMs / subtickCount
      for (let i = 1; i < subtickCount; i += 1) {
        // Each subsequent subtick is quieter than the previous one.
        const intensity = 1 / (i + 1)
        window.setTimeout(() => {
          playTickRef.current(isPrimary, intensity)
        }, interval * i)
      }
    },
    [tickMs],
  )

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

        const activePattern = patternRef.current
        const nextTick = next - COUNT_IN_TICKS
        const tickInPattern = nextTick % activePattern.length
        const isPrimary = tickInPattern === 0
        playTick(isPrimary)
        const requiredThisTick = activePattern[tickInPattern] ?? []
        scheduleSubticks(isPrimary, requiredThisTick.length)

        if (nextTick === 0) {
          setHandledActions([])
          tickHasErrorRef.current = false
          return next
        }

        const previousTick = nextTick - 1
        const previousRequired = activePattern[previousTick % activePattern.length] ?? []
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
  }, [active, playTick, scheduleSubticks, tickMs])

  const handleAction = useCallback(
    (action: ActionId) => {
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
    },
    [currentTick, handledActions, isRunning, requiredActions],
  )

  const startRun = useCallback(() => {
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
  }, [])

  const stopRun = useCallback(() => {
    if (isRunning) {
      const done = new Set(handledActionsRef.current)
      const finalRequired = patternRef.current[currentTick % patternRef.current.length] ?? []
      const missed = finalRequired.some((action) => !done.has(action))
      const tickFailed = missed || tickHasErrorRef.current
      setRunTicks((prev) => prev + 1)
      if (!tickFailed) {
        setStreak((prev) => {
          const nextStreak = prev + 1
          setBestStreak((best) => (nextStreak > best ? nextStreak : best))
          return nextStreak
        })
      }
    }

    setActive(false)
    setShowStats(true)
    tickHasErrorRef.current = false
  }, [currentTick, isRunning])

  return {
    active,
    isRunning,
    countdown,
    currentTick,
    requiredActions,
    tickStatuses,
    streak,
    bestStreak,
    runTicks,
    runSuccesses,
    runFailures,
    showStats,
    handleAction,
    startRun,
    stopRun,
  }
}
