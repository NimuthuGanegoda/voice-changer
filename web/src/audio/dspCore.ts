export type DSPParams = {
  semitones: number;
  formantShift: number;
  highpassHz: number;
  presenceDb: number;
  gateThresholdDb: number;
  robotMix: number;
  echoMix: number;
  wetMix: number;
  inputGain: number;
  outputGain: number;
  bypass: boolean;
};

export type VoicePreset = {
  id: string;
  name: string;
  badge: string;
  category: "character" | "studio";
  description: string;
  params: DSPParams;
};

export const DEFAULT_DSP_PARAMS: DSPParams = {
  semitones: 3.5,
  formantShift: 2.5,
  highpassHz: 95,
  presenceDb: 2.5,
  gateThresholdDb: -54,
  robotMix: 0,
  echoMix: 0,
  wetMix: 1,
  inputGain: 1,
  outputGain: 1,
  bypass: false,
};

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "zenin-maki",
    name: "Zenin Maki (JJK)",
    badge: "+2.5 st",
    category: "character",
    description: "Assertive crisp alto timbre (pairs with ZeninMaki_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 2.5,
      formantShift: 1.5,
      highpassHz: 95,
      presenceDb: 3.5,
      gateThresholdDb: -52,
    },
  },
  {
    id: "misa-amane",
    name: "Misa Amane (Death Note)",
    badge: "+6.0 st",
    category: "character",
    description: "Sparkling Idol soprano with bright formant lift (pairs with MisaAmane_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 6.0,
      formantShift: 4.5,
      highpassHz: 135,
      presenceDb: 4.5,
      gateThresholdDb: -50,
    },
  },
  {
    id: "mikasa-ackerman",
    name: "Mikasa Ackerman (AoT)",
    badge: "+2.0 st",
    category: "character",
    description: "Composed disciplined low-alto contour (pairs with MikasaAckerman_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 2.0,
      formantShift: 1.0,
      highpassHz: 85,
      presenceDb: 2.5,
      gateThresholdDb: -53,
    },
  },
  {
    id: "hinata-hyuga",
    name: "Hinata Hyuga (Naruto)",
    badge: "+5.0 st",
    category: "character",
    description: "Gentle airy soft-spoken soprano (pairs with HinataHyuga_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 5.0,
      formantShift: 3.5,
      highpassHz: 120,
      presenceDb: 2.0,
      echoMix: 0.04,
      gateThresholdDb: -55,
    },
  },
  {
    id: "power-csm",
    name: "Power (Chainsaw Man)",
    badge: "+4.0 st",
    category: "character",
    description: "Brash high-energy Fiend vocal edge (pairs with Power_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 4.0,
      formantShift: 2.5,
      highpassHz: 115,
      presenceDb: 5.5,
      gateThresholdDb: -50,
    },
  },
  {
    id: "makima",
    name: "Makima (Chainsaw Man)",
    badge: "+1.5 st",
    category: "character",
    description: "Poised hypnotic velvet alto control (pairs with Makima_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 1.5,
      formantShift: 1.2,
      highpassHz: 80,
      presenceDb: 3.0,
      gateThresholdDb: -54,
    },
  },
  {
    id: "raiden-shogun",
    name: "Raiden Shogun",
    badge: "-0.5 st",
    category: "character",
    description: "Commanding sovereign contralto (pairs with RaidenShogun_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: -0.5,
      formantShift: 0.8,
      highpassHz: 75,
      presenceDb: 3.2,
      echoMix: 0.08,
      gateThresholdDb: -54,
    },
  },
  {
    id: "yae-miko",
    name: "Yae Miko",
    badge: "+2.5 st",
    category: "character",
    description: "Silky teasing Kitsune Guuji resonance (pairs with YaeMiko_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 2.5,
      formantShift: 2.0,
      highpassHz: 90,
      presenceDb: 3.8,
      gateThresholdDb: -53,
    },
  },
  {
    id: "gojo-satoru",
    name: "Gojo Satoru (JJK)",
    badge: "-2.5 st",
    category: "character",
    description: "Relaxed charismatic tenor-baritone (pairs with GojoSatoru_RVC)",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: -2.5,
      formantShift: -1.8,
      highpassHz: 70,
      presenceDb: 2.8,
      gateThresholdDb: -54,
    },
  },
  {
    id: "natural-fem",
    name: "Soft Feminine",
    badge: "+3.5 st",
    category: "studio",
    description: "Bright vocal lift with subtle formant scaling and warm clarity",
    params: { ...DEFAULT_DSP_PARAMS },
  },
  {
    id: "anime-bright",
    name: "Anime / Bright",
    badge: "+5.5 st",
    category: "studio",
    description: "Crisp high-register character voice with tightened low cut",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 5.5,
      formantShift: 4.0,
      highpassHz: 130,
      presenceDb: 4.0,
      gateThresholdDb: -50,
    },
  },
  {
    id: "deep-baritone",
    name: "Deep Baritone",
    badge: "-4.5 st",
    category: "studio",
    description: "Lowered chest register with darker formant tilt",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: -4.5,
      formantShift: -3.5,
      highpassHz: 60,
      presenceDb: 1.5,
    },
  },
  {
    id: "studio-clean",
    name: "Studio Broadcast",
    badge: "0 st",
    category: "studio",
    description: "Natural pitch with noise gate, rumble filter, and air EQ",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 0,
      formantShift: 0.5,
      highpassHz: 90,
      presenceDb: 3.5,
      gateThresholdDb: -52,
    },
  },
  {
    id: "cyber-radio",
    name: "Cyber Comms",
    badge: "-1.5 st",
    category: "studio",
    description: "Focused tactical radio presence with subtle echo tail",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: -1.5,
      formantShift: 1.5,
      highpassHz: 260,
      presenceDb: 6.0,
      echoMix: 0.18,
      robotMix: 0.15,
    },
  },
  {
    id: "droid-synth",
    name: "Holo Synth",
    badge: "-3.0 st",
    category: "studio",
    description: "Robotic carrier modulation + octave shimmer",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: -3.0,
      formantShift: -1.5,
      highpassHz: 110,
      presenceDb: 3.0,
      robotMix: 0.72,
      echoMix: 0.22,
    },
  },
  {
    id: "bypass",
    name: "Raw Bypass",
    badge: "Dry",
    category: "studio",
    description: "Direct dry signal monitor for instant A/B comparison",
    params: {
      ...DEFAULT_DSP_PARAMS,
      semitones: 0,
      formantShift: 0,
      bypass: true,
    },
  },
];

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const dbToLinear = (db: number): number => Math.pow(10, db / 20);

export const linearToDb = (lin: number): number => 20 * Math.log10(Math.max(lin, 1e-6));

/**
 * Real-time dual-tap OLA granular pitch shifter + RMS noise gate + ring mod + feedback echo.
 * Uses complementary sin^2 / cos^2 Hann grain windows across half-period staggered read taps so
 * amplitude sums cleanly to 1.0 with zero comb-envelope flutter.
 */
export class VoiceProcessor {
  private readonly bufferSize: number;
  private readonly buffer: Float32Array;
  private readonly echoSize: number;
  private readonly echoBuf: Float32Array;
  private writeIdx = 0;
  private echoIdx = 0;
  private phase = 0;
  private robotPhase = 0;
  private gateEnv = 0.03;
  private rmsEnv = 0;

  constructor(private readonly sampleRate = 48000, bufferSeconds = 0.25) {
    this.bufferSize = Math.max(4096, Math.ceil(sampleRate * bufferSeconds));
    this.buffer = new Float32Array(this.bufferSize);
    this.echoSize = Math.max(4096, Math.ceil(sampleRate * 0.22));
    this.echoBuf = new Float32Array(this.echoSize);
  }

  reset(): void {
    this.buffer.fill(0);
    this.echoBuf.fill(0);
    this.writeIdx = 0;
    this.echoIdx = 0;
    this.phase = 0;
    this.robotPhase = 0;
    this.gateEnv = 0.03;
    this.rmsEnv = 0;
  }

  private readFrac(delaySamples: number): number {
    let pos = this.writeIdx - delaySamples;
    while (pos < 0) pos += this.bufferSize;
    while (pos >= this.bufferSize) pos -= this.bufferSize;
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.bufferSize;
    const frac = pos - i0;
    const s0 = this.buffer[i0] ?? 0;
    const s1 = this.buffer[i1] ?? 0;
    return s0 + (s1 - s0) * frac;
  }

  processBlock(input: Float32Array, output: Float32Array, params: DSPParams): { inPeak: number; outPeak: number } {
    const n = Math.min(input.length, output.length);
    const grainSamples = Math.min(Math.floor(this.sampleRate * 0.042), Math.floor(this.bufferSize * 0.45));
    const semitones = clamp(params.semitones, -12, 12);
    const pitchRatio = Math.pow(2, semitones / 12);
    const phaseStep = (1 - pitchRatio) / grainSamples;
    const gateThresh = params.gateThresholdDb <= -79 ? 0 : dbToLinear(params.gateThresholdDb);
    const inGain = clamp(params.inputGain, 0, 3);
    const outGain = clamp(params.outputGain, 0, 3);
    const robotMix = clamp(params.robotMix, 0, 1);
    const echoMix = clamp(params.echoMix, 0, 1);
    const wetMix = clamp(params.wetMix, 0, 1);
    const robotStep = (2 * Math.PI * 115) / this.sampleRate;

    let inPeak = 0;
    let outPeak = 0;

    for (let i = 0; i < n; i++) {
      const raw = (input[i] ?? 0) * inGain;
      const absRaw = raw < 0 ? -raw : raw;
      if (absRaw > inPeak) inPeak = absRaw;

      // Fast attack / smooth release RMS follower for noise gate
      this.rmsEnv = this.rmsEnv * 0.992 + absRaw * 0.008;
      const gateTarget = this.rmsEnv >= gateThresh ? 1 : 0.03;
      const coeff = gateTarget > this.gateEnv ? 0.08 : 0.003;
      this.gateEnv += (gateTarget - this.gateEnv) * coeff;

      const gated = raw * this.gateEnv;
      this.buffer[this.writeIdx] = gated;

      let pitched: number;
      if (params.bypass || Math.abs(semitones) < 0.01) {
        pitched = gated;
      } else {
        const phaseA = this.phase;
        const phaseB = (phaseA + 0.5) % 1;
        const winA = Math.sin(Math.PI * phaseA);
        const wA = winA * winA;
        const wB = 1 - wA;
        const sA = this.readFrac(2 + phaseA * grainSamples);
        const sB = this.readFrac(2 + phaseB * grainSamples);
        pitched = sA * wA + sB * wB;
      }

      this.phase += phaseStep;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      else if (this.phase < 0) this.phase += Math.ceil(-this.phase);

      let effected = pitched;
      if (!params.bypass && robotMix > 0) {
        const carrier = 0.65 * Math.sin(this.robotPhase) + 0.35 * Math.sin(this.robotPhase * 2);
        this.robotPhase += robotStep;
        if (this.robotPhase > 2 * Math.PI) this.robotPhase -= 2 * Math.PI;
        effected = effected * (1 - robotMix) + effected * carrier * 1.45 * robotMix;
      }

      const prevEcho = this.echoBuf[this.echoIdx] ?? 0;
      this.echoBuf[this.echoIdx] = effected + prevEcho * 0.32;
      this.echoIdx = (this.echoIdx + 1) % this.echoSize;

      if (!params.bypass && echoMix > 0) {
        effected = effected + prevEcho * echoMix;
      }

      let mixed = params.bypass ? raw : gated * (1 - wetMix) + effected * wetMix;
      mixed *= outGain;
      // Gentle soft knee above 0.92 so sudden speech peaks stay clean
      if (mixed > 0.92 || mixed < -0.92) {
        mixed = Math.tanh(mixed);
      }

      output[i] = mixed;
      const absOut = mixed < 0 ? -mixed : mixed;
      if (absOut > outPeak) outPeak = absOut;

      this.writeIdx = (this.writeIdx + 1) % this.bufferSize;
    }

    return { inPeak, outPeak };
  }
}

export const resampleFloat32 = (input: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate || input.length === 0) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  if (input.length === 1) {
    out.fill(input[0] ?? 0);
    return out;
  }
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? 0;
    out[i] = s0 + (s1 - s0) * (pos - i0);
  }
  return out;
};

export const float32ToInt16 = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = clamp(input[i] ?? 0, -1, 1);
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
};

export const int16ToFloat32 = (input: Int16Array): Float32Array => {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] ?? 0) / 32768.0;
  }
  return out;
};
