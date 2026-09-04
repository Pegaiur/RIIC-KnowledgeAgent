/** 九个设施的独立人工优化批次注册表。 */
import { CONTROL_CURATIONS } from './control.js'
import { DORMITORY_CURATIONS } from './dormitory.js'
import { MANUFACTURING_CURATIONS } from './manufacturing.js'
import { MEETING_CURATIONS } from './meeting.js'
import { OFFICE_CURATIONS } from './office.js'
import { POWER_CURATIONS } from './power.js'
import { PROCESSING_CURATIONS } from './processing.js'
import { TRADE_CURATIONS } from './trade.js'
import { TRAINING_CURATIONS } from './training.js'

export const ALL_CURATIONS = [
  OFFICE_CURATIONS,
  POWER_CURATIONS,
  MEETING_CURATIONS,
  PROCESSING_CURATIONS,
  CONTROL_CURATIONS,
  TRADE_CURATIONS,
  DORMITORY_CURATIONS,
  TRAINING_CURATIONS,
  MANUFACTURING_CURATIONS,
]
