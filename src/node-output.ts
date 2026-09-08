/**
 * Finish final Node CLI output before a caller-owned forced exit.
 *
 * The default drains stdout and stderr; callers can select a subset or an
 * empty list. Every selected stream settles before this rejects with the
 * original first failure, and this helper never decides the exit itself.
 */
export async function drainOutput(
  streams: readonly NodeJS.WritableStream[] = [process.stdout, process.stderr],
): Promise<void> {
  let firstFailure: { readonly reason: unknown } | undefined
  const observeFailure = (reason: unknown): void => {
    firstFailure ??= { reason }
  }

  const settlements = streams.map((stream) =>
    drainStream(stream, observeFailure),
  )
  await Promise.allSettled(settlements)
  if (firstFailure !== undefined) throw firstFailure.reason
}

function drainStream(
  stream: NodeJS.WritableStream,
  observeFailure: (reason: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onError = (error: unknown): void => {
      if (settled) return
      settled = true
      observeFailure(error)
      reject(error)
    }
    const onComplete = (error?: Error | null): void => {
      if (error !== undefined && error !== null) {
        onError(error)
        return
      }
      if (settled) return
      settled = true
      stream.removeListener("error", onError)
      resolve()
    }

    try {
      stream.on("error", onError)
      stream.end(onComplete)
    } catch (error) {
      onError(error)
    }
  })
}
