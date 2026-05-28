interface RunStatsProps {
  runTicks: number
  runSuccesses: number
  runFailures: number
  onShare: () => void
}

export function RunStats({ runTicks, runSuccesses, runFailures, onShare }: RunStatsProps) {
  const totalInputs = runSuccesses + runFailures
  const accuracy = totalInputs > 0 ? Math.round((runSuccesses / totalInputs) * 100) : 0

  return (
    <section className="stats" aria-live="polite">
      <h2>Run stats</h2>
      <p>Total ticks: {runTicks}</p>
      <p>Correct inputs: {runSuccesses}</p>
      <p>Failed inputs: {runFailures}</p>
      <p>Accuracy: {accuracy}%</p>
      <button type="button" onClick={onShare}>
        Share best streak
      </button>
    </section>
  )
}
