// A short, locally generated two-note chime; no audio downloads or permissions.
export function createNotificationChime(scope = globalThis) {
  let context, disposed = false
  return {
    async unlock() {
      if (disposed) return false
      try {
        const AudioContext = scope.AudioContext || scope.webkitAudioContext
        if (!AudioContext) return false
        context ||= new AudioContext()
        if (context.state !== 'running') await context.resume()
        return !disposed && context.state === 'running'
      } catch { return false }
    },
    play() {
      if (disposed || context?.state !== 'running') return false
      try {
        for (const [delay, frequency] of [[0, 660], [0.16, 880]]) {
          const start = context.currentTime + delay
          const oscillator = context.createOscillator(), gain = context.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.setValueAtTime(frequency, start)
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(0.065, start + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.19)
          oscillator.connect(gain); gain.connect(context.destination)
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
          oscillator.start(start); oscillator.stop(start + 0.21)
        }
        return true
      } catch { return false }
    },
    dispose() { disposed = true; if (context && context.state !== 'closed') void context.close().catch(() => {}) }
  }
}
