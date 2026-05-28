import type { TrainerMeta } from './types'

export const TRAINERS: TrainerMeta[] = [
  {
    id: 'threeTickFishing',
    name: '3-tick fishing',
    description: 'Practice herb-tar + fishing spot timing on true 0.6s OSRS ticks.',
    enabled: true,
  },
  {
    id: 'twoTickTeaks',
    name: '2-tick teaks',
    description: 'Coming soon',
    enabled: false,
  },
  {
    id: 'onePointFiveT',
    name: '1.5-tick hunter',
    description: 'Coming soon',
    enabled: false,
  },
]

export function findTrainer(id: TrainerMeta['id']): TrainerMeta | undefined {
  return TRAINERS.find((trainer) => trainer.id === id)
}
