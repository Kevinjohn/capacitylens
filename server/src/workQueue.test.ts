import { describe, expect, it } from 'vitest'
import { BoundedWorkQueue, WorkQueueFullError } from './workQueue'

describe('BoundedWorkQueue', () => {
  it('bounds active work, preserves the queue and refuses overflow', async () => {
    const queue = new BoundedWorkQueue(2, 1, 'busy')
    const releases: (() => void)[] = []
    let active = 0
    let peak = 0
    const work = (value: number) => queue.run(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return value
    })

    const first = work(1)
    const second = work(2)
    const queued = work(3)
    await expect(work(4)).rejects.toBeInstanceOf(WorkQueueFullError)
    expect(active).toBe(2)
    expect(peak).toBe(2)

    releases.shift()!()
    await expect(first).resolves.toBe(1)
    await Promise.resolve()
    expect(active).toBe(2)
    releases.shift()!()
    releases.shift()!()
    await expect(Promise.all([second, queued])).resolves.toEqual([2, 3])
    expect(peak).toBe(2)
  })

  it('releases a slot after failed work', async () => {
    const queue = new BoundedWorkQueue(1, 1, 'busy')
    await expect(queue.run(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered')
  })
})
