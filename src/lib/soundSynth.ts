/**
 * ALAZ NEON Cinematic Whoosh Synthesizer
 * Generates a high-quality "whoosh" sound using white noise and dynamic filtering.
 * No external assets required.
 */
export function playCinematicWhoosh() {
    if (typeof window === 'undefined') return;
    
    try {
        const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioContextCtor();
        const bufferSize = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);

        // Populate with white noise
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 5;

        const gainNode = audioCtx.createGain();

        // Premium "Transition Whoosh" (Option 3 Style)
        const now = audioCtx.currentTime;
        const duration = 2.0; // Longer for premium feel

        filter.Q.value = 12; // Sharper, more "whistling" effect
        filter.frequency.setValueAtTime(50, now);
        filter.frequency.exponentialRampToValueAtTime(4000, now + duration * 0.4);
        filter.frequency.exponentialRampToValueAtTime(1200, now + duration * 0.7);
        filter.frequency.exponentialRampToValueAtTime(200, now + duration);

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.5, now + duration * 0.35);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        noise.start(now);
        noise.stop(now + duration);

        // Cleanup
        setTimeout(() => audioCtx.close(), (duration + 0.2) * 1000);
    } catch (e) {
        console.warn('Failed to synthesize whoosh:', e);
    }
}
