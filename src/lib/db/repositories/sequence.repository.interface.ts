export interface SequenceRepository {
  next(type: string, prefix: string): Promise<string>
}
