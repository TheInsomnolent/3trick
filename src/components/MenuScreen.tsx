import type { TrainerMeta } from '../trainers/types'

interface MenuScreenProps {
  trainers: TrainerMeta[]
  onSelect: (trainer: TrainerMeta) => void
  cursor?: string
}

export function MenuScreen({ trainers, onSelect, cursor }: MenuScreenProps) {
  return (
    <main className="menu-screen" style={cursor ? { cursor } : undefined}>
      <h1>3trick training dojo</h1>
      <p className="menu-subtitle">Pick a trainer from common OSRS tick manipulation methods.</p>
      <section className="trainer-list" aria-label="Trainer methods">
        {trainers.map((method) => (
          <button
            key={method.id}
            type="button"
            className="trainer-card"
            disabled={!method.enabled}
            onClick={() => onSelect(method)}
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
