interface TrainerHeaderProps {
  title: string
  streak: number
  bestStreak: number
  onBack: () => void
}

export function TrainerHeader({ title, streak, bestStreak, onBack }: TrainerHeaderProps) {
  return (
    <header className="top-bar">
      <button type="button" onClick={onBack}>
        ← Menu
      </button>
      <h1>{title}</h1>
      <div className="streak">Streak: {streak}</div>
      <div className="streak">Best: {bestStreak}</div>
    </header>
  )
}
