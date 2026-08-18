class EnvelopeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.release = Math.exp(-1 / (0.08 * sampleRate));
    this.dcR = 0.995;
    this.calibrateSamples = Math.round(sampleRate);
    this.maxWindow = Math.round(sampleRate * 0.5);
    this.minThreshold = 1e-4;
    this.levelInterval = Math.round(sampleRate * 0.05);
    this.dcX = [0, 0];
    this.dcY = [0, 0];
    this.env = [0, 0];
    this.threshold = [this.minThreshold, this.minThreshold];
    this.holdTh = [this.minThreshold * 0.2, this.minThreshold * 0.2];
    this.calSumSq = [0, 0];
    this.calPeak = [0, 0];
    this.calCount = 0;
    this.sampleIndex = 0;
    this.levelCount = 0;
    this.onsetL = null;
    this.onsetR = null;
    this.captureStart = 0;
    this.reportedChannels = -1;
    this.state = '';
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'recalibrate')
        this.resetCalibration();
    };
    this.resetCalibration();
  }

  resetCalibration() {
    this.calSumSq = [0, 0];
    this.calPeak = [0, 0];
    this.calCount = 0;
    this.env = [0, 0];
    this.onsetL = null;
    this.onsetR = null;
    this.setState('calibrating');
  }

  setState(next) {
    if (this.state === next)
      return;
    this.state = next;
    this.port.postMessage({ type: 'status', state: next });
  }

  dcBlock(ch, x) {
    const y = x - this.dcX[ch] + this.dcR * this.dcY[ch];
    this.dcX[ch] = x;
    this.dcY[ch] = y;
    return y;
  }

  follow(ch, absX) {
    const decayed = this.env[ch] * this.release;
    this.env[ch] = absX > decayed ? absX : decayed;
  }

  floorFor(rms, peak) {
    const hold = Math.max(peak * 2.5, rms * 4, this.minThreshold * 0.2);
    const threshold = Math.max(peak * 6, rms * 10, hold * 3, this.minThreshold);
    return { hold, threshold };
  }

  calibrate(absL, absR) {
    this.calSumSq[0] += absL * absL;
    this.calSumSq[1] += absR * absR;
    if (absL > this.calPeak[0])
      this.calPeak[0] = absL;
    if (absR > this.calPeak[1])
      this.calPeak[1] = absR;
    this.calCount++;
    if (this.calCount < this.calibrateSamples)
      return;
    const rmsL = Math.sqrt(this.calSumSq[0] / this.calCount);
    const rmsR = Math.sqrt(this.calSumSq[1] / this.calCount);
    const L = this.floorFor(rmsL, this.calPeak[0]);
    const R = this.floorFor(rmsR, this.calPeak[1]);
    this.holdTh[0] = L.hold;
    this.holdTh[1] = R.hold;
    this.threshold[0] = L.threshold;
    this.threshold[1] = R.threshold;
    this.port.postMessage({
      type: 'calibrated',
      noiseL: rmsL,
      noiseR: rmsR,
      peakL: this.calPeak[0],
      peakR: this.calPeak[1],
      thresholdL: this.threshold[0],
      thresholdR: this.threshold[1],
      sampleRate: sampleRate
    });
    this.setState('armed');
  }

  resultPayload() {
    return {
      type: 'result',
      onsetL: this.onsetL,
      onsetR: this.onsetR,
      envL: this.env[0],
      envR: this.env[1],
      thresholdL: this.threshold[0],
      thresholdR: this.threshold[1],
      sampleRate: sampleRate
    };
  }

  maybeFinishCapture() {
    const both = this.onsetL !== null && this.onsetR !== null;
    const timedOut = (this.sampleIndex - this.captureStart) >= this.maxWindow;
    if (!both && !timedOut)
      return;
    this.port.postMessage(this.resultPayload());
    this.setState('hold');
  }

  postLevels() {
    this.port.postMessage({
      type: 'levels',
      envL: this.env[0],
      envR: this.env[1],
      thresholdL: this.threshold[0],
      thresholdR: this.threshold[1],
      holdL: this.holdTh[0],
      holdR: this.holdTh[1],
      state: this.state
    });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0] || !input[0].length)
      return true;

    const left = input[0];
    const right = input.length > 1 ? input[1] : null;
    const frames = left.length;

    if (this.reportedChannels !== input.length) {
      this.reportedChannels = input.length;
      this.port.postMessage({ type: 'channels', count: input.length });
    }

    for (let i = 0; i < frames; i++) {
      const xL = this.dcBlock(0, left[i]);
      const xR = right ? this.dcBlock(1, right[i]) : 0;
      const absL = xL < 0 ? -xL : xL;
      const absR = xR < 0 ? -xR : xR;
      this.follow(0, absL);
      this.follow(1, absR);

      if (this.state === 'calibrating') {
        this.calibrate(absL, absR);
      } else if (this.state === 'armed') {
        if (this.env[0] >= this.threshold[0])
          this.onsetL = this.sampleIndex;
        if (this.env[1] >= this.threshold[1])
          this.onsetR = this.sampleIndex;
        if (this.onsetL !== null || this.onsetR !== null) {
          this.captureStart = this.sampleIndex;
          this.setState('capturing');
          this.maybeFinishCapture();
        }
      } else if (this.state === 'capturing') {
        if (this.onsetL === null && this.env[0] >= this.threshold[0])
          this.onsetL = this.sampleIndex;
        if (this.onsetR === null && this.env[1] >= this.threshold[1])
          this.onsetR = this.sampleIndex;
        this.maybeFinishCapture();
      } else if (this.env[0] < this.holdTh[0] && this.env[1] < this.holdTh[1]) {
        this.onsetL = null;
        this.onsetR = null;
        this.setState('armed');
      }

      this.sampleIndex++;
    }

    this.levelCount += frames;
    if (this.levelCount >= this.levelInterval) {
      this.levelCount = 0;
      this.postLevels();
    }

    return true;
  }
}

registerProcessor('envelope-processor', EnvelopeProcessor);
