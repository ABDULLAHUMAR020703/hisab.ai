export type {
  DocumentType,
  DocumentSequenceRecord,
  DocumentSequenceUpdateInput,
} from './types'
export { DOCUMENT_TYPES, DOCUMENT_TYPE_DEFAULTS } from './types'
export {
  formatDocumentNumber,
  extractTrailingSequenceNumber,
  previewDocumentNumber,
  isPlausibleSequenceNumber,
  MAX_DOCUMENT_SEQUENCE_NUMBER,
} from './format'
export { validateDocumentSequenceUpdate } from './validation'
export {
  allocateDocumentNumber,
  ensureDocumentSequence,
  listDocumentSequences,
  getDocumentSequence,
  updateDocumentSequence,
  resetDocumentSequenceToDefault,
  getMinAllowedNextNumber,
  seedDefaultDocumentSequencesForCompany,
  repairInvoiceDocumentSequence,
  isCorruptInvoiceSequence,
  buildPreview,
} from './service'
