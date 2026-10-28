/** A bounded test-only rendezvous outside the product transaction. */
export function requestBarrier() {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const bounded = async (promise: Promise<void>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Request barrier timed out')), 5000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    entered: () => bounded(entered),
    release,
    pause: async () => {
      enter()
      await bounded(released)
    },
  }
}
