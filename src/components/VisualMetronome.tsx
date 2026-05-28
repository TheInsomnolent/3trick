import type { ActionDefinition, TickStatus } from '../trainers/types'

interface VisualMetronomeProps<ActionId extends string> {
  pattern: ActionId[][]
  currentTick: number
  isRunning: boolean
  tickStatuses: Record<string, TickStatus>
  visibility: number
  actions: Record<ActionId, ActionDefinition>
}

export function VisualMetronome<ActionId extends string>({
  pattern,
  currentTick,
  isRunning,
  tickStatuses,
  visibility,
  actions,
}: VisualMetronomeProps<ActionId>) {
  return (
    <section className="visual-metronome" style={{ opacity: visibility }}>
      {pattern.map((tickActions, tickIndex) => (
        <div
          key={tickIndex}
          className={`metronome-tick ${tickIndex === currentTick % pattern.length && isRunning ? 'current' : ''}`}
        >
          <div className="tick-label">Tick {tickIndex + 1}</div>
          <div className="tick-actions">
            {tickActions.length === 0 && <span className="wait">Wait</span>}
            {tickActions.map((action) => {
              const key = `${currentTick}:${action}`
              const status = tickStatuses[key] ?? 'pending'
              return (
                <div
                  key={action}
                  className={`tick-action ${status}`}
                  title={actions[action].description}
                >
                  <img src={actions[action].icon} alt="" />
                  <span>{actions[action].label}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
