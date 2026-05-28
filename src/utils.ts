import type { TrainerId } from './trainers/types'

export const BASE_TICK_MS = 600
export const COUNT_IN_TICKS = 4
export const STORAGE_PREFIX = '3trick.best.'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function segmentProgress(value: number, start: number, end: number) {
  if (value <= start) {
    return 0
  }

  if (value >= end) {
    return 1
  }

  return (value - start) / (end - start)
}

export function readBestStreak(trainerId: TrainerId) {
  const saved = Number.parseInt(localStorage.getItem(`${STORAGE_PREFIX}${trainerId}`) ?? '0', 10)
  return Number.isFinite(saved) ? saved : 0
}
