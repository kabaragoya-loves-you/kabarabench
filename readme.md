# Kabarabench

Browser tool that measures which stereo channel arrives first, and by how much.

It opens the default audio input, calibrates against ambient noise, then records the sample index of the first envelope crossing on left and right. The difference is reported in microseconds or milliseconds.

## Requirements

- A Chromium-based browser (AudioWorklet + `getUserMedia`)
- A stereo audio input
- Served over `http://localhost` or HTTPS. Worklet modules will not load from `file://`

## Running

Serve this directory and open `index.html`. For example:

```
python -m http.server
```

Then open http://localhost:8000 and grant microphone permission.

## Using it

1. Keep the room quiet during calibration (about one second). Thresholds are derived from measured noise RMS and peak on each channel.
2. Status becomes `listening` when armed.
3. Send a transient into both channels (click, clap into a stereo mic, loopback of a pulse, and so on).
4. The page reports which side led and by how many samples / µs / ms.
5. It waits until both envelopes fall below a hold floor, then arms again.
6. Running min / mean / max of the L−R deltas accumulate in the stats line.

Live levels show current envelope vs threshold. A channel lights up when it is over threshold.

If the input is not stereo, the status line says so and right-channel onsets will not be meaningful.

## Notes

- Echo cancellation, noise suppression, and auto gain are requested off. The browser or OS may still apply processing.
- Timing is sample-accurate within the AudioWorklet input. Reported time is `samples / sampleRate`.
- Capture window is 0.5 s. If only one side crosses, the trial is logged as L only or R only.

## Files

- `index.html` — UI and AudioContext wiring
- `processor.js` — AudioWorklet envelope follower and onset detector

## License

MIT. Copyright Kabaragoya. See `LICENSE`.
