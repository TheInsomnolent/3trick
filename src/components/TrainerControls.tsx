interface TrainerControlsProps {
  active: boolean
  countdown: number
  tickSpeed: number
  speedSlider: number
  volume: number
  visualVisibility: number
  autoScale: boolean
  onStart: () => void
  onStop: () => void
  onSpeedChange: (value: number) => void
  onVolumeChange: (value: number) => void
  onVisualVisibilityChange: (value: number) => void
  onAutoScaleChange: (value: boolean) => void
}

export function TrainerControls({
  active,
  countdown,
  tickSpeed,
  speedSlider,
  volume,
  visualVisibility,
  autoScale,
  onStart,
  onStop,
  onSpeedChange,
  onVolumeChange,
  onVisualVisibilityChange,
  onAutoScaleChange,
}: TrainerControlsProps) {
  return (
    <section className="controls">
      <button type="button" onClick={onStart} disabled={active}>
        {countdown > 0 ? `Count-in ${countdown}` : 'Start (4 tick count-in)'}
      </button>
      <button type="button" onClick={onStop} disabled={!active}>
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
          onChange={(event) => onSpeedChange(Number(event.target.value))}
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
          onChange={(event) => onVolumeChange(Number(event.target.value))}
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
          onChange={(event) => onVisualVisibilityChange(Number(event.target.value))}
        />
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={autoScale}
          onChange={(event) => onAutoScaleChange(event.target.checked)}
        />
        Auto difficulty scaler
      </label>
    </section>
  )
}
