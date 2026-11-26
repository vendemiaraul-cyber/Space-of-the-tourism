// Every sound is synthesized with WebAudio: engine hum, alarms, catapult, boost, stamps, servos.
export class Sound {
  constructor() { this.ctx = null; this.on = true; this.alarmTimer = null; }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.8 : 0; this.master.connect(c.destination);
    // shared noise buffer
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // engine: two detuned saws + a sub sine through a lowpass, plus filtered rumble
    const eg = (this.engGain = c.createGain()); eg.gain.value = 0;
    const lp = (this.engLP = c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 2;
    lp.connect(eg); eg.connect(this.master);
    this.engOsc = [55, 55.6, 27.5].map((f, i) => { const o = c.createOscillator(); o.type = i === 2 ? 'sine' : 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = (this.rumbleBP = c.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.7;
    const rg = (this.rumbleGain = c.createGain()); rg.gain.value = 0;
    n.connect(bp); bp.connect(rg); rg.connect(this.master); n.start();
    // ambient pad
    const pad = c.createGain(); pad.gain.value = 0.035; pad.connect(this.master);
    [110, 164.8, 220.5, 329.6].forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = 0.25;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03; const lg = c.createGain(); lg.gain.value = 0.2;
      lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(pad); o.start(); lfo.start();
    });
  }

  setMuted(m) { this.on = !m; if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime, 0.05); }

  engine(throttle, speedNorm, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, base = 42 + speedNorm * 50 + (boost ? 25 : 0);
    this.engOsc[0].frequency.setTargetAtTime(base, t, 0.2);
    this.engOsc[1].frequency.setTargetAtTime(base * 1.012, t, 0.2);
    this.engOsc[2].frequency.setTargetAtTime(base / 2, t, 0.2);
    this.engLP.frequency.setTargetAtTime(180 + throttle * 600 + (boost ? 900 : 0), t, 0.15);
    this.engGain.gain.setTargetAtTime(0.05 + throttle * 0.08 + (boost ? 0.06 : 0), t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(0.02 + speedNorm * 0.06 + (boost ? 0.12 : 0), t, 0.15);
    this.rumbleBP.frequency.setTargetAtTime(120 + speedNorm * 260 + (boost ? 300 : 0), t, 0.2);
  }

  tone(freq, dur = 0.12, type = 'sine', vol = 0.2, glideTo = null, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  hiss(dur = 1, from = 400, to = 4000, vol = 0.25, q = 1, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  }

  click() { this.tone(1400, 0.04, 'square', 0.06); this.tone(600, 0.06, 'square', 0.05, null, 0.03); }
  beep(high) { this.tone(high ? 1320 : 880, 0.16, 'sine', 0.18); }
  servo(up = true) { this.tone(up ? 140 : 320, 0.5, 'sawtooth', 0.05, up ? 320 : 140); this.tone(90, 0.08, 'square', 0.08, null, 0.5); }
  boost() { this.hiss(0.9, 300, 3000, 0.3, 0.8); this.tone(60, 0.5, 'sine', 0.35, 30); }
  stamp() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14, null, i * 0.09)); this.tone(80, 0.15, 'square', 0.12, null, 0.4); }
  jumpCharge() { this.tone(80, 2.4, 'sawtooth', 0.12, 900); this.hiss(2.4, 200, 6000, 0.18, 2); }
  jumpFlash() { this.hiss(1.6, 6000, 200, 0.35, 0.6); this.tone(200, 1.2, 'sine', 0.3, 40); }
  thud() { this.tone(70, 0.35, 'sine', 0.4, 35); this.hiss(0.3, 200, 120, 0.2); }
  catapult() { this.tone(40, 1.8, 'sawtooth', 0.25, 160); this.hiss(1.8, 150, 2500, 0.35, 0.6); this.tone(55, 0.7, 'square', 0.15, 30, 1.5); }
  whoosh() { this.hiss(1.4, 2500, 200, 0.4, 0.7); }
  doorOpen() { this.tone(50, 3, 'sawtooth', 0.12, 70); this.hiss(3, 300, 900, 0.12, 0.5); this.thud(); }
  alarm(on) {
    clearInterval(this.alarmTimer);
    if (!on || !this.ctx) return;
    let hi = false;
    this.alarmTimer = setInterval(() => { hi = !hi; this.tone(hi ? 740 : 560, 0.32, 'square', 0.05); }, 380);
  }
}
