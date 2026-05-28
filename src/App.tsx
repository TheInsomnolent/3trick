import { useMemo, useState } from 'react'
import { abyssalWhip, toDataUrl } from '@dava96/osrs-icons'
import { MenuScreen } from './components/MenuScreen'
import { ThreeTickFishingTrainer } from './trainers/ThreeTickFishingTrainer'
import { ThreeTickFishingDropTrainer } from './trainers/ThreeTickFishingDropTrainer'
import { TRAINERS } from './trainers/registry'
import type { TrainerId } from './trainers/types'
import './App.css'

function App() {
  const [trainerId, setTrainerId] = useState<TrainerId | null>(null)
  const osrsCursor = useMemo(() => `url(${toDataUrl(abyssalWhip)}) 2 2, auto`, [])

  if (trainerId === 'threeTickFishing') {
    return <ThreeTickFishingTrainer cursor={osrsCursor} onBack={() => setTrainerId(null)} />
  }

  if (trainerId === 'threeTickFishingDrop') {
    return <ThreeTickFishingDropTrainer cursor={osrsCursor} onBack={() => setTrainerId(null)} />
  }

  return (
    <MenuScreen
      trainers={TRAINERS}
      cursor={osrsCursor}
      onSelect={(trainer) => setTrainerId(trainer.id)}
    />
  )
}

export default App
