export type TrainerId =
  | 'threeTickFishing'
  | 'threeTickFishingDrop'
  | 'twoTickTeaks'
  | 'onePointFiveT'
export type TickStatus = 'pending' | 'success' | 'failed'

export interface TrainerMeta {
  id: TrainerId
  name: string
  description: string
  enabled: boolean
}

export interface ActionDefinition {
  label: string
  icon: string
  description: string
}
