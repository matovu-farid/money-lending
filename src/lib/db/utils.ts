export function escapeLikePattern(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}
