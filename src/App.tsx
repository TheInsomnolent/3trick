import { useState } from 'react'
import { MenuScreen } from './components/MenuScreen'
import { ThreeTickFishingTrainer } from './trainers/ThreeTickFishingTrainer'
import { ThreeTickFishingDropTrainer } from './trainers/ThreeTickFishingDropTrainer'
import { TRAINERS } from './trainers/registry'
import type { TrainerId } from './trainers/types'
import './App.css'

function App() {
  const [trainerId, setTrainerId] = useState<TrainerId | null>(null)

  if (trainerId === 'threeTickFishing') {
    return <ThreeTickFishingTrainer onBack={() => setTrainerId(null)} />
  }

  if (trainerId === 'threeTickFishingDrop') {
    return <ThreeTickFishingDropTrainer onBack={() => setTrainerId(null)} />
  }

  return (
    <MenuScreen
      trainers={TRAINERS}
      onSelect={(trainer) => setTrainerId(trainer.id)}
    />
  )
}

export default App
