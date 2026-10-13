export const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
        'stun:global.stun.twilio.com:3478',
      ],
    },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelay',
      credential: 'openrelay',
    },
  ],
  iceCandidatePoolSize: 10,
};

/**
 * Creates an AudioContext analyser to monitor real-time microphone volume levels
 */
export function createAudioLevelMeter(
  stream: MediaStream,
  onVolumeChange: (volume: number) => void
): () => void {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    onVolumeChange(0);
    return () => {};
  }

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.5;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationFrameId: number;
    let isDisposed = false;

    const checkVolume = () => {
      if (isDisposed) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalise to 0 - 100
      const volumeLevel = Math.min(100, Math.round((average / 128) * 100));
      onVolumeChange(volumeLevel);
      animationFrameId = requestAnimationFrame(checkVolume);
    };

    animationFrameId = requestAnimationFrame(checkVolume);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
      audioContext.close().catch(() => {});
    };
  } catch (err) {
    console.warn('AudioContext not supported or failed to init:', err);
    return () => {};
  }
}
