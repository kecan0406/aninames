function unit(code: number): number {
  return code >= 0xe000 ? code - 0x800 : code >= 0xd800 ? code + 0x2000 : code
}

export function compare(a: string, b: string): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) return unit(x) - unit(y)
  }
  return a.length - b.length
}
