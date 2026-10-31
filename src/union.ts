import type { Kind } from './model.ts'

export class Union {
  private parent = new Map<string, string>()
  private items = new Map<string, string>()
  refused = 0

  has(key: string): boolean {
    return this.parent.has(key)
  }

  add(key: string): void {
    if (this.parent.has(key)) return
    this.parent.set(key, key)
    if (key.includes('|wikidata:')) this.items.set(key, key)
  }

  anchored(key: string): boolean {
    return this.items.has(this.find(key))
  }

  find(key: string): string {
    let root = key
    for (let next = this.parent.get(root); next !== undefined && next !== root; next = this.parent.get(root)) {
      root = next
    }
    let walk = key
    while (walk !== root) {
      const next = this.parent.get(walk) ?? root
      this.parent.set(walk, root)
      walk = next
    }
    return root
  }

  union(a: string, b: string): boolean {
    this.add(a)
    this.add(b)
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return true
    const ia = this.items.get(ra)
    const ib = this.items.get(rb)
    if (ia && ib && ia !== ib) {
      this.refused++
      return false
    }
    this.parent.set(rb, ra)
    const item = ia ?? ib
    if (item) this.items.set(ra, item)
    return true
  }
}

export function node(kind: Kind, ref: string): string {
  return `${kind}|${ref}`
}
