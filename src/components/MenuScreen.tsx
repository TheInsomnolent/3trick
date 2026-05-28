import type { TrainerMeta } from '../trainers/types'

interface MenuScreenProps {
  trainers: TrainerMeta[]
  onSelect: (trainer: TrainerMeta) => void
}

export function MenuScreen({ trainers, onSelect }: MenuScreenProps) {
  return (
    <main className="menu-screen">
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
      <footer className="credits" aria-label="Asset credits">
        <p>
          &quot;Default osrs model&quot;{' '}
          (<a
            href="https://skfb.ly/pqGPF"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://skfb.ly/pqGPF
          </a>) by pkzz is licensed under Creative Commons Attribution (
          <a
            href="http://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            http://creativecommons.org/licenses/by/4.0/
          </a>
          ).
        </p>
      </footer>
    </main>
  )
}
