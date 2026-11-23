import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CURATED_AI_MODELS,
  SampleModelEntry,
  ServerHealth,
  ServerInfo,
  SoundboardStatus,
  VCServerClient,
  VoicePresetMap,
  normalizeServerUrl,
} from "./api/vcServerClient";
import { DEFAULT_DSP_PARAMS, DSPParams, VOICE_PRESETS, linearToDb } from "./audio/dspCore";
import {
  BROWSER_ONNX_MODELS,
  BrowserOnnxRvcEngine,
  CONTENTVEC_ONNX_URL,
  CREPE_TINY_ONNX_URL,
  OnnxVoiceModel,
  PitchMethod,
} from "./audio/onnxRvcEngine";
import {
  AudioSourceKind,
  BrowserVoiceEngine,
  EngineMode,
  TelemetrySnapshot,
  convertBufferViaServer,
  extractMonoFloat32,
} from "./audio/voiceEngine";
import { encodeWav, renderOfflineDsp } from "./audio/wavEncoder";
import { Oscilloscope } from "./components/Oscilloscope";

type Theme = "dark" | "light";

const formatDb = (peak: number): string => {
  if (peak < 0.0005) return "-inf dB";
  return `${Math.round(linearToDb(peak))} dB`;
};

const meterPercent = (peak: number): number => {
  if (peak <= 0.0001) return 0;
  const db = linearToDb(peak);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [mode, setMode] = useState<EngineMode>("onnx");
  const [source, setSource] = useState<AudioSourceKind>("file");
  const [params, setParams] = useState<DSPParams>(VOICE_PRESETS[0]?.params ?? DEFAULT_DSP_PARAMS);
  const [activePresetId, setActivePresetId] = useState<string>(VOICE_PRESETS[0]?.id ?? "natural-fem");
  const [presetQuery, setPresetQuery] = useState<string>("");

  const [monitorEnabled, setMonitorEnabled] = useState<boolean>(true);
  const [monitorVolume, setMonitorVolume] = useState<number>(1.0);
  const [echoCancellation, setEchoCancellation] = useState<boolean>(true);
  const [noiseSuppression, setNoiseSuppression] = useState<boolean>(false);

  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [uploadedName, setUploadedName] = useState<string>("");
  const [uploadedDuration, setUploadedDuration] = useState<number>(0);

  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>({
    running: false,
    inPeak: 0,
    outPeak: 0,
    sampleRate: 48000,
    latencyMs: 0,
    serverRttMs: null,
    engineKind: "Idle",
  });

  const [recording, setRecording] = useState<boolean>(false);
  const [analysers, setAnalysers] = useState<{ input: AnalyserNode | null; output: AnalyserNode | null }>({
    input: null,
    output: null,
  });
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedSeconds, setRecordedSeconds] = useState<number>(0);
  const [exportedFileUrl, setExportedFileUrl] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Server Bridge State
  const [serverUrl, setServerUrl] = useState<string>("http://127.0.0.1:18888");
  const [accessToken, setAccessToken] = useState<string>("");
  const [serverConnecting, setServerConnecting] = useState<boolean>(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [serverPresets, setServerPresets] = useState<VoicePresetMap>({});
  const [soundboardFiles, setSoundboardFiles] = useState<string[]>([]);
  const [soundboardStatus, setSoundboardStatus] = useState<SoundboardStatus | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [targetSlot, setTargetSlot] = useState<number>(0);
  const [busySampleId, setBusySampleId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState<string>("");
  const [useIndexOnInstall, setUseIndexOnInstall] = useState<boolean>(true);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [serverConvertBusy, setServerConvertBusy] = useState<boolean>(false);
  const [exportingOnnx, setExportingOnnx] = useState<boolean>(false);

  // Browser Neural ONNX RVC State
  const [selectedOnnxId, setSelectedOnnxId] = useState<string>(BROWSER_ONNX_MODELS[0]?.id ?? "Tsukuyomi-chan_o");
  const [onnxCustomName, setOnnxCustomName] = useState<string>("");
  const [contentVecReady, setContentVecReady] = useState<boolean>(false);
  const [onnxVoiceReady, setOnnxVoiceReady] = useState<boolean>(false);
  const [crepeReady, setCrepeReady] = useState<boolean>(false);
  const [onnxPitchMethod, setOnnxPitchMethod] = useState<PitchMethod>("yin");
  const [onnxTune, setOnnxTune] = useState<number>(10);
  const [onnxStatus, setOnnxStatus] = useState<string>(
    "Select a voice and click Convert Voice — ContentVec encoder downloads once (~378 MB) and caches in your browser.",
  );
  const [onnxBusy, setOnnxBusy] = useState<boolean>(false);
  const [onnxResultUrl, setOnnxResultUrl] = useState<string | null>(null);
  const [onnxMicRecording, setOnnxMicRecording] = useState<boolean>(false);

  const engineRef = useRef<BrowserVoiceEngine | null>(null);
  const onnxEngineRef = useRef<BrowserOnnxRvcEngine | null>(null);
  const onnxResultUrlRef = useRef<string | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const serverClientRef = useRef<VCServerClient | null>(null);
  const recordedUrlRef = useRef<string | null>(null);
  const exportedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const engine = new BrowserVoiceEngine(VOICE_PRESETS[0]?.params ?? DEFAULT_DSP_PARAMS, {
      onTelemetry: (snap) => setTelemetry(snap),
    });
    engineRef.current = engine;
    onnxEngineRef.current = new BrowserOnnxRvcEngine();
    return () => {
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      if (exportedUrlRef.current) URL.revokeObjectURL(exportedUrlRef.current);
      if (onnxResultUrlRef.current) URL.revokeObjectURL(onnxResultUrlRef.current);
      if (mediaStreamRef.current) {
        for (const t of mediaStreamRef.current.getTracks()) t.stop();
      }
      void engine.dispose();
    };
  }, []);

  const refreshMics = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioIns = devices.filter((d) => d.kind === "audioinput");
      setMics(audioIns);
      if (!selectedMicId && audioIns[0]?.deviceId) {
        setSelectedMicId(audioIns[0].deviceId);
      }
    } catch {
      // Permission not yet granted
    }
  }, [selectedMicId]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) return;
        const audioIns = devices.filter((d) => d.kind === "audioinput");
        setMics(audioIns);
        if (audioIns[0]?.deviceId) {
          setSelectedMicId((prev) => prev || audioIns[0]!.deviceId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const updateParams = (patch: Partial<DSPParams>, clearPreset = true) => {
    setParams((prev) => {
      const next = { ...prev, ...patch };
      engineRef.current?.updateParams(next);
      return next;
    });
    if (clearPreset) setActivePresetId("");
  };

  const applyPreset = (id: string) => {
    const preset = VOICE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActivePresetId(preset.id);
    const next = { ...preset.params };
    setParams(next);
    engineRef.current?.updateParams(next);
  };

  const handleSourceSwitch = (nextSource: AudioSourceKind) => {
    setSource(nextSource);
    // Automatically enable monitoring for sample/file audition; keep user preference on mic
    const autoMonitor = nextSource !== "mic" ? true : monitorEnabled;
    setMonitorEnabled(autoMonitor);
    engineRef.current?.setMonitor(autoMonitor, monitorVolume);
  };

  const handleToggleStart = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setErrorMsg(null);

    if (telemetry.running) {
      if (recording) {
        const res = engine.stopRecording();
        setRecording(false);
        if (res) {
          if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
          const url = URL.createObjectURL(res.blob);
          recordedUrlRef.current = url;
          setRecordedUrl(url);
          setRecordedSeconds(res.durationSec);
        }
      }
      await engine.stop();
      setAnalysers({ input: null, output: null });
      return;
    }

    try {
      let serverConvert;
      if (mode === "server") {
        const client = serverClientRef.current ?? new VCServerClient(serverUrl, accessToken);
        serverClientRef.current = client;
        if (!serverInfo) {
          await handleConnectServer();
        }
        serverConvert = (pcm: ArrayBuffer) => client.convertVoicePcm16(pcm);
      }

      await engine.start({
        mode,
        source,
        deviceId: selectedMicId || undefined,
        echoCancellation,
        noiseSuppression,
        serverConvert,
        monitorEnabled,
        monitorVolume,
      });
      setAnalysers({ input: engine.inputAnalyser, output: engine.outputAnalyser });
      await refreshMics();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFileUpload = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file || !engineRef.current) return;
    setErrorMsg(null);
    try {
      const { duration } = await engineRef.current.decodeUploadedFile(file);
      setUploadedName(file.name);
      setUploadedDuration(duration);
      handleSourceSwitch("file");
      if (exportedUrlRef.current) {
        URL.revokeObjectURL(exportedUrlRef.current);
        exportedUrlRef.current = null;
      }
      setExportedFileUrl(null);
    } catch (err) {
      setErrorMsg(`Failed to decode audio file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOfflineExport = async () => {
    const buf = engineRef.current?.getUploadedBuffer();
    if (!buf) return;
    setExportBusy(true);
    setErrorMsg(null);
    try {
      const wav = await renderOfflineDsp(buf, params);
      if (exportedUrlRef.current) URL.revokeObjectURL(exportedUrlRef.current);
      const url = URL.createObjectURL(wav);
      exportedUrlRef.current = url;
      setExportedFileUrl(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  };

  const handleLoadLocalOnnxEncoder = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file || !onnxEngineRef.current) return;
    setOnnxBusy(true);
    setErrorMsg(null);
    setOnnxStatus(`Loading ContentVec encoder from ${file.name}...`);
    try {
      const bytes = await file.arrayBuffer();
      await onnxEngineRef.current.ensureContentVec(bytes);
      setContentVecReady(true);
      setOnnxStatus(`ContentVec encoder loaded from ${file.name}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setOnnxBusy(false);
    }
  };

  const handleLoadLocalOnnxVoice = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file || !onnxEngineRef.current) return;
    setOnnxBusy(true);
    setErrorMsg(null);
    setOnnxStatus(`Loading custom ONNX voice ${file.name}...`);
    try {
      const bytes = await file.arrayBuffer();
      const meta = await onnxEngineRef.current.ensureRvcModel(`local:${file.name}`, bytes);
      setOnnxVoiceReady(true);
      setOnnxCustomName(file.name);
      setOnnxStatus(`Loaded "${file.name}" (${meta.sampleRate} Hz, ${meta.embChannels} ch) — ready for in-browser inference.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setOnnxBusy(false);
    }
  };

  const handleOnnxMicToggle = async () => {
    if (onnxMicRecording) {
      mediaRecRef.current?.stop();
      setOnnxMicRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMsg("Browser microphone recording is unavailable here; upload a WAV/MP3 speech file below.");
      return;
    }
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      mediaRecRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) mediaChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        mediaStreamRef.current = null;
        const blob = new Blob(mediaChunksRef.current, { type: rec.mimeType || "audio/webm" });
        const file = new File([blob], "mic-phrase.webm", { type: blob.type });
        void engineRef.current?.decodeUploadedFile(file).then(({ duration }) => {
          setUploadedName("Recorded Mic Speech");
          setUploadedDuration(duration);
          setOnnxStatus(`Captured ${duration.toFixed(1)}s mic speech — click Convert Voice with Neural ONNX.`);
        });
      };
      rec.start();
      setOnnxMicRecording(true);
      setOnnxStatus("Recording microphone... click Stop Recording when done.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunOnnxConvert = async () => {
    const onnxEngine = onnxEngineRef.current;
    const buf = engineRef.current?.getUploadedBuffer();
    if (!onnxEngine) return;
    if (!buf) {
      setErrorMsg("Record your mic or upload a voice audio file (.wav/.mp3/.m4a) first.");
      return;
    }
    setOnnxBusy(true);
    setErrorMsg(null);
    try {
      if (!onnxEngine.hasContentVec()) {
        setOnnxStatus("Downloading & caching ContentVec ONNX (~378 MB, one-time)...");
        await onnxEngine.ensureContentVec(CONTENTVEC_ONNX_URL, (loaded, total) => {
          const mb = (loaded / (1024 * 1024)).toFixed(1);
          const tot = total ? `${(total / (1024 * 1024)).toFixed(0)} MB` : "? MB";
          setOnnxStatus(`Downloading ContentVec ONNX: ${mb} / ${tot} (cached once)...`);
        });
        setContentVecReady(true);
      }

      if (onnxPitchMethod === "crepe" && !crepeReady) {
        setOnnxStatus("Downloading CREPE-tiny pitch model (~2 MB)...");
        await onnxEngine.ensureCrepe(CREPE_TINY_ONNX_URL);
        setCrepeReady(true);
      }

      if (!onnxCustomName) {
        const chosen: OnnxVoiceModel =
          BROWSER_ONNX_MODELS.find((m) => m.id === selectedOnnxId) ?? BROWSER_ONNX_MODELS[0]!;
        setOnnxStatus(`Loading neural RVC voice ${chosen.name}...`);
        await onnxEngine.ensureRvcModel(chosen.id, chosen.modelUrl, chosen.sampleRate, (loaded, total) => {
          const mb = (loaded / (1024 * 1024)).toFixed(1);
          const tot = total ? `${(total / (1024 * 1024)).toFixed(0)} MB` : "~55 MB";
          setOnnxStatus(`Loading ${chosen.name}: ${mb} / ${tot}...`);
        });
        setOnnxVoiceReady(true);
      }

      const mono = extractMonoFloat32(buf);
      const { audio, sampleRate } = await onnxEngine.convertMonoAudio(mono, buf.sampleRate, {
        transposeSemitones: onnxTune,
        pitchMethod: onnxPitchMethod,
        onStage: (msg) => setOnnxStatus(msg),
      });
      const wavBlob = encodeWav(audio, sampleRate);
      if (onnxResultUrlRef.current) URL.revokeObjectURL(onnxResultUrlRef.current);
      const url = URL.createObjectURL(wavBlob);
      onnxResultUrlRef.current = url;
      setOnnxResultUrl(url);
      setOnnxStatus(`Conversion complete (${sampleRate} Hz neural ONNX output).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setOnnxBusy(false);
    }
  };

  const handleServerConvertFile = async () => {
    const client = serverClientRef.current;
    const buf = engineRef.current?.getUploadedBuffer();
    if (!client || !serverInfo) {
      setErrorMsg("Connect to your VC Client server first.");
      return;
    }
    if (!buf) {
      setErrorMsg("Upload or record an audio file first.");
      return;
    }
    setServerConvertBusy(true);
    setErrorMsg(null);
    setServerNote("Converting full file cleanly via local AI server (no live frame drops)...");
    try {
      const mono = extractMonoFloat32(buf);
      const wav = await convertBufferViaServer(mono, buf.sampleRate, (pcm) => client.convertVoicePcm16(pcm), (done, total) => {
        setServerNote(`Server neural RVC progress: block ${done}/${total}...`);
      });
      if (exportedUrlRef.current) URL.revokeObjectURL(exportedUrlRef.current);
      const url = URL.createObjectURL(wav);
      exportedUrlRef.current = url;
      setExportedFileUrl(url);
      setServerNote("Server neural conversion complete — play or download below.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setServerConvertBusy(false);
    }
  };

  const handleExportSlotToBrowserOnnx = async () => {
    const client = serverClientRef.current;
    if (!client || !serverInfo) return;
    setExportingOnnx(true);
    setErrorMsg(null);
    setServerNote("Exporting active PyTorch RVC slot -> simplified ONNX (can take 15-45s)...");
    try {
      const res = await client.exportSlotOnnx();
      if (res.status !== "ok" || !res.path) {
        throw new Error(res.msg || "Slot could not be exported to ONNX (slot must be a PyTorch RVC v1/v2 checkpoint).");
      }
      setServerNote(`Fetching exported ${res.filename || "model.onnx"} into Browser Neural Engine...`);
      const bytes = await client.fetchServerBinary(res.path);
      const name = res.filename || "exported-rvc.onnx";
      if (onnxEngineRef.current) {
        await onnxEngineRef.current.ensureRvcModel(`server:${name}`, bytes);
        setOnnxVoiceReady(true);
        setOnnxCustomName(name);
      }
      setMode("onnx");
      setOnnxStatus(`Imported "${name}" directly from your server into Browser Neural (ONNX)!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingOnnx(false);
    }
  };

  const handleToggleRecord = () => {
    const engine = engineRef.current;
    if (!engine || !telemetry.running) return;
    if (!recording) {
      engine.startRecording();
      setRecording(true);
    } else {
      const res = engine.stopRecording();
      setRecording(false);
      if (res) {
        if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
        const url = URL.createObjectURL(res.blob);
        recordedUrlRef.current = url;
        setRecordedUrl(url);
        setRecordedSeconds(res.durationSec);
      }
    }
  };

  const handleConnectServer = async () => {
    setServerConnecting(true);
    setErrorMsg(null);
    try {
      const client = new VCServerClient(serverUrl, accessToken);
      serverClientRef.current = client;
      const health = await client.getHealth();
      setServerHealth(health);
      const info = await client.getInfo();
      setServerInfo(info);
      const firstEmpty = (info.modelSlots ?? []).find((s) => !s.modelFile);
      if (firstEmpty !== undefined && typeof firstEmpty.slotIndex === "number") {
        setTargetSlot(firstEmpty.slotIndex);
      } else if (typeof info.modelSlotIndex === "number") {
        setTargetSlot(info.modelSlotIndex);
      }
      try {
        const presets = await client.getPresets();
        setServerPresets(presets.presets ?? {});
      } catch {
        setServerPresets({});
      }
      try {
        const [sbList, sbStatus] = await Promise.all([client.getSoundboardList(), client.getSoundboardStatus()]);
        setSoundboardFiles(sbList.files ?? []);
        setSoundboardStatus(sbStatus);
      } catch {
        setSoundboardFiles([]);
      }
    } catch (err) {
      setServerHealth(null);
      setServerInfo(null);
      const originHint = typeof window !== "undefined" ? window.location.origin : "https://nimuthuganegoda.github.io";
      const detail = err instanceof Error ? err.message : String(err);
      setErrorMsg(
        `Could not connect to VC Client server (${detail}). Make sure your server is running with --allowed-origins ${originHint} and valid bearer token if enabled.`,
      );
    } finally {
      setServerConnecting(false);
    }
  };

  const handleServerSetting = async (key: string, val: string | number | boolean) => {
    if (!serverClientRef.current) return;
    setErrorMsg(null);
    setServerNote(null);
    try {
      const updated = await serverClientRef.current.updateSetting(key, val);
      setServerInfo(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInstallSample = async (sample: SampleModelEntry) => {
    const client = serverClientRef.current;
    if (!client || !serverInfo) {
      setErrorMsg("Connect to your local VC Client server first to install neural RVC weights.");
      return;
    }
    setBusySampleId(sample.id);
    setErrorMsg(null);
    setServerNote(`Downloading & extracting ${sample.name} into Slot #${targetSlot}...`);
    try {
      await client.installSampleModel({
        slot: targetSlot,
        sampleId: sample.id,
        voiceChangerType: sample.voiceChangerType || "RVC",
        useIndex: useIndexOnInstall,
      });
      await client.updateSetting("modelSlotIndex", targetSlot);
      const refreshed = await client.getInfo();
      setServerInfo(refreshed);
      setServerNote(`Installed and activated "${sample.name}" on Slot #${targetSlot}.`);
    } catch (err) {
      setServerNote(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySampleId(null);
    }
  };

  const handleUploadLocalModel = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files ? Array.from(ev.target.files) : [];
    ev.target.value = "";
    if (files.length === 0) return;
    const client = serverClientRef.current;
    if (!client || !serverInfo) {
      setErrorMsg("Connect to your local VC Client server first to upload RVC .zip / .pth files.");
      return;
    }
    setErrorMsg(null);
    setServerNote(null);
    setUploadProgress(`Preparing ${files.map((f) => f.name).join(" + ")}...`);
    try {
      await client.installLocalRvcFiles({
        slot: targetSlot,
        files,
        useIndex: useIndexOnInstall,
        onProgress: setUploadProgress,
      });
      await client.updateSetting("modelSlotIndex", targetSlot);
      const refreshed = await client.getInfo();
      setServerInfo(refreshed);
      setServerNote(`Uploaded & loaded onto Slot #${targetSlot}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadProgress("");
    }
  };

  const corsOriginCommand = useMemo(() => {
    const origin = typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? window.location.origin
      : "https://nimuthuganegoda.github.io";
    return `start_local.bat --allowed-origins ${origin}`;
  }, []);

  const linuxCorsOriginCommand = useMemo(() => {
    const origin = typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? window.location.origin
      : "https://nimuthuganegoda.github.io";
    return `bash start_local.sh --allowed-origins ${origin}`;
  }, []);

  const validServerHref = useMemo(() => {
    try {
      return normalizeServerUrl(serverUrl);
    } catch {
      return null;
    }
  }, [serverUrl]);

  const activeSlots = useMemo(() => {
    return (serverInfo?.modelSlots ?? []).filter((slot) => Boolean(slot.modelFile));
  }, [serverInfo]);

  const filteredPresets = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    if (!q) return VOICE_PRESETS;
    return VOICE_PRESETS.filter(
      (preset) => preset.name.toLowerCase().includes(q) || preset.description.toLowerCase().includes(q),
    );
  }, [presetQuery]);

  const aiCatalog = useMemo(() => {
    const byId = new Map<string, SampleModelEntry>();
    for (const item of CURATED_AI_MODELS) {
      byId.set(item.id, item);
    }
    for (const item of serverInfo?.sampleModels ?? []) {
      if (item?.id) {
        byId.set(item.id, item);
      }
    }
    const q = catalogQuery.trim().toLowerCase();
    const list = Array.from(byId.values());
    if (!q) return list;
    return list.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.credit ?? "").toLowerCase().includes(q) ||
        (item.tag ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [catalogQuery, serverInfo?.sampleModels]);

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <span className={`brand-dot ${telemetry.running ? "live" : ""}`} aria-hidden="true" />
          <div>
            <h1>VC Client Web Studio</h1>
            <div className="brand-sub">Standalone Browser Voice Changer + Local AI Server Bridge</div>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="mode-switch" role="tablist" aria-label="Voice processing engine mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "onnx"}
              className={`mode-tab ${mode === "onnx" ? "active" : ""}`}
              onClick={() => {
                if (telemetry.running) {
                  void engineRef.current?.stop();
                  setAnalysers({ input: null, output: null });
                }
                setMode("onnx");
              }}
            >
              Browser Neural (ONNX)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "browser"}
              className={`mode-tab ${mode === "browser" ? "active" : ""}`}
              onClick={() => {
                if (telemetry.running) {
                  void engineRef.current?.stop();
                  setAnalysers({ input: null, output: null });
                }
                setMode("browser");
              }}
            >
              Browser DSP
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "server"}
              className={`mode-tab ${mode === "server" ? "active" : ""}`}
              onClick={() => {
                if (telemetry.running) {
                  void engineRef.current?.stop();
                  setAnalysers({ input: null, output: null });
                }
                setMode("server");
              }}
            >
              AI Server Bridge
            </button>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            title="Toggle dark/light theme"
          >
            {theme === "dark" ? "Light UI" : "Dark UI"}
          </button>

          <a
            className="btn btn-primary"
            href="https://github.com/NimuthuGanegoda/voice-changer/releases/latest/download/VoiceChanger.exe"
          >
            Desktop EXE
          </a>
        </div>
      </header>

      {errorMsg && (
        <div className="error-banner" role="alert">
          {errorMsg}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Audio Transport & Scope</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge ${telemetry.running ? "ok" : ""}`}>{telemetry.engineKind}</span>
            {telemetry.running && <span className="badge mono">{telemetry.sampleRate} Hz</span>}
            {telemetry.running && <span className="badge mono">~{telemetry.latencyMs} ms</span>}
            {telemetry.serverRttMs !== null && <span className="badge warn mono">RTT {telemetry.serverRttMs} ms</span>}
          </div>
        </div>

        <div className="transport-grid">
          <div className="source-tabs">
            <button
              type="button"
              className={`source-pill ${source === "sample" ? "active" : ""}`}
              onClick={() => handleSourceSwitch("sample")}
            >
              Vocal Test Phrase
            </button>
            <button
              type="button"
              className={`source-pill ${source === "mic" ? "active" : ""}`}
              onClick={() => handleSourceSwitch("mic")}
            >
              Live Microphone
            </button>
            <button
              type="button"
              className={`source-pill ${source === "file" ? "active" : ""}`}
              onClick={() => handleSourceSwitch("file")}
            >
              Audio File {uploadedName ? `(${uploadedDuration.toFixed(1)}s)` : ""}
            </button>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              disabled={!telemetry.running && !params.bypass}
              onClick={() => updateParams({ bypass: !params.bypass }, false)}
            >
              {params.bypass ? "Bypass: ON" : "Bypass: OFF"}
            </button>

            <button
              type="button"
              className={`btn ${recording ? "btn-danger" : ""}`}
              disabled={!telemetry.running}
              onClick={handleToggleRecord}
            >
              {recording ? "Stop Rec" : "Rec WAV"}
            </button>

            <button
              type="button"
              className={`btn ${telemetry.running ? "btn-danger" : "btn-primary"}`}
              onClick={() => void handleToggleStart()}
            >
              {telemetry.running ? "Stop Engine" : "Start Voice Changer"}
            </button>
          </div>
        </div>

        {source === "mic" && (
          <div className="form-row" style={{ marginTop: "12px" }}>
            <div className="input-group">
              <label htmlFor="mic-select">Microphone Input</label>
              <select
                id="mic-select"
                className="select-input"
                value={selectedMicId}
                onChange={(e) => setSelectedMicId(e.target.value)}
              >
                {mics.length === 0 ? (
                  <option value="">Default System Microphone (click Start to grant access)</option>
                ) : (
                  mics.map((mic, i) => (
                    <option key={mic.deviceId || `mic-${i}`} value={mic.deviceId}>
                      {mic.label || `Microphone ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.84rem" }}>
              <input
                type="checkbox"
                checked={echoCancellation}
                onChange={(e) => setEchoCancellation(e.target.checked)}
              />
              Echo Cancel
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.84rem" }}>
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => setNoiseSuppression(e.target.checked)}
              />
              Browser Denoise
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.84rem" }}>
              <input
                type="checkbox"
                checked={monitorEnabled}
                onChange={(e) => {
                  const v = e.target.checked;
                  setMonitorEnabled(v);
                  engineRef.current?.setMonitor(v, monitorVolume);
                }}
              />
              Monitor Speakers (use headphones)
            </label>
          </div>
        )}

        {source === "file" && (
          <div className="form-row" style={{ marginTop: "12px" }}>
            <div className="input-group">
              <label htmlFor="audio-file">Upload Voice Audio (.wav, .mp3, .ogg, .flac, .m4a)</label>
              <input id="audio-file" type="file" accept="audio/*" onChange={(e) => void handleFileUpload(e)} />
            </div>
            {mode === "browser" && uploadedName && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={exportBusy}
                onClick={() => void handleOfflineExport()}
              >
                {exportBusy ? "Rendering..." : "Render & Export DSP WAV"}
              </button>
            )}
            {mode === "server" && uploadedName && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!serverInfo || serverConvertBusy}
                onClick={() => void handleServerConvertFile()}
              >
                {serverConvertBusy ? "Converting..." : "Convert File via Server (Clean RVC)"}
              </button>
            )}
            {exportedFileUrl && (
              <>
                <audio controls src={exportedFileUrl} style={{ height: "34px", flex: "1 1 200px" }} />
                <a className="btn" href={exportedFileUrl} download={`converted_${uploadedName.replace(/\.[^.]+$/, "")}.wav`}>
                  Download Converted File
                </a>
              </>
            )}
          </div>
        )}

        {recordedUrl && (
          <div
            className="form-row"
            style={{
              marginTop: "12px",
              padding: "10px 12px",
              background: "var(--panel-raised)",
              borderRadius: "6px",
              border: "1px solid var(--line)",
            }}
          >
            <span className="mono" style={{ fontSize: "0.82rem" }}>
              Recorded output ({recordedSeconds.toFixed(1)}s)
            </span>
            <audio controls src={recordedUrl} style={{ height: "34px", flex: "1 1 220px" }} />
            <a className="btn btn-primary" href={recordedUrl} download="vcclient-recording.wav">
              Download WAV
            </a>
          </div>
        )}

        <div className="scope-wrap">
          <Oscilloscope
            inputAnalyser={analysers.input}
            outputAnalyser={analysers.output}
            running={telemetry.running}
            bypass={params.bypass}
          />
          <div className="telemetry-row">
            <div className="meter-card">
              <div className="meter-label">
                <span>Input Dry Level</span>
                <span className="mono">{formatDb(telemetry.inPeak)}</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill in" style={{ width: `${meterPercent(telemetry.inPeak)}%` }} />
              </div>
            </div>
            <div className="meter-card">
              <div className="meter-label">
                <span>Converted Output Level</span>
                <span className="mono">{formatDb(telemetry.outPeak)}</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill" style={{ width: `${meterPercent(telemetry.outPeak)}%` }} />
              </div>
            </div>
            <div className="meter-card">
              <div className="meter-label">
                <span>Monitor Speaker Vol</span>
                <span className="mono">{monitorEnabled ? `${Math.round(monitorVolume * 100)}%` : "Muted"}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={monitorVolume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMonitorVolume(v);
                  engineRef.current?.setMonitor(monitorEnabled, v);
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {mode === "onnx" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>In-Browser Neural RVC Engine (onnxruntime-web · Zero Python Required)</h2>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span className={`badge ${contentVecReady ? "ok" : ""}`}>
                {contentVecReady ? "ContentVec Ready" : "ContentVec Unloaded"}
              </span>
              <span className={`badge ${onnxVoiceReady ? "ok" : ""}`}>
                {onnxVoiceReady ? `Model: ${onnxCustomName || selectedOnnxId}` : "Pick Voice .onnx"}
              </span>
            </div>
          </div>

          <p style={{ margin: "0 0 12px", fontSize: "0.84rem", color: "var(--text-muted)" }}>
            Runs genuine RVC v2 neural networks directly inside Chrome/Edge via WebAssembly (`contentvec-f.onnx` +{" "}
            {onnxPitchMethod === "crepe" ? "CREPE-tiny ONNX" : "YIN"} F0 + RVC `.onnx` vocoder). HuggingFace creators
            for Zenin Maki / Misa Amane / Mikasa / Hinata / Power / Makima only publish PyTorch `.pth` pickles — use{" "}
            <strong>AI Server Bridge</strong> on Windows/Linux to run them live OR export them to `.onnx` for standalone
            browser use below.
          </p>

          <div className="preset-grid">
            {BROWSER_ONNX_MODELS.map((model) => {
              const isSelected = !onnxCustomName && selectedOnnxId === model.id;
              return (
                <button
                  type="button"
                  key={model.id}
                  className={`preset-card ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setOnnxCustomName("");
                    setSelectedOnnxId(model.id);
                    setOnnxTune(model.recommendedTune);
                    setOnnxVoiceReady(false);
                  }}
                >
                  <div className="preset-top">
                    <span className="preset-name">{model.name}</span>
                    <span className="badge mono">{Math.round(model.sampleRate / 1000)}k</span>
                  </div>
                  <div className="preset-desc">{model.description}</div>
                </button>
              );
            })}
          </div>

          <div className="controls-grid" style={{ marginTop: "14px" }}>
            <div className="slider-field">
              <div className="slider-head">
                <span>Pitch Tune (Semitones)</span>
                <strong className="mono">{onnxTune >= 0 ? `+${onnxTune}` : onnxTune} st</strong>
              </div>
              <input
                type="range"
                min={-16}
                max={16}
                step={1}
                value={onnxTune}
                onChange={(e) => setOnnxTune(Number(e.target.value))}
              />
              <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                <button type="button" className="btn" style={{ padding: "3px 8px", fontSize: "0.74rem" }} onClick={() => setOnnxTune(12)}>
                  +12 Deep-&gt;Fem
                </button>
                <button type="button" className="btn" style={{ padding: "3px 8px", fontSize: "0.74rem" }} onClick={() => setOnnxTune(0)}>
                  0 Same Register
                </button>
                <button type="button" className="btn" style={{ padding: "3px 8px", fontSize: "0.74rem" }} onClick={() => setOnnxTune(-12)}>
                  -12 Fem-&gt;Deep
                </button>
              </div>
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Pitch Extractor</span>
                <strong className="mono">{onnxPitchMethod === "crepe" ? "CREPE ONNX (~2MB)" : "YIN Instant"}</strong>
              </div>
              <select
                className="select-input"
                value={onnxPitchMethod}
                onChange={(e) => setOnnxPitchMethod(e.target.value as PitchMethod)}
              >
                <option value="yin">YIN Pitch Tracker (0 MB download)</option>
                <option value="crepe">CREPE-tiny ONNX (downloads ~2 MB once)</option>
              </select>
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Load Local .onnx Files</span>
                <strong className="mono">{onnxCustomName ? "Custom" : "HF CDN"}</strong>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                <label className="btn" style={{ padding: "5px 9px", fontSize: "0.76rem", cursor: "pointer" }}>
                  Pick Character .onnx
                  <input type="file" accept=".onnx" style={{ display: "none" }} onChange={(e) => void handleLoadLocalOnnxVoice(e)} />
                </label>
                <label className="btn" style={{ padding: "5px 9px", fontSize: "0.76rem", cursor: "pointer" }}>
                  Pick contentvec.onnx
                  <input type="file" accept=".onnx" style={{ display: "none" }} onChange={(e) => void handleLoadLocalOnnxEncoder(e)} />
                </label>
              </div>
            </div>
          </div>

          <div className="form-row" style={{ marginTop: "14px" }}>
            <button
              type="button"
              className={`btn ${onnxMicRecording ? "btn-danger" : ""}`}
              disabled={onnxBusy}
              onClick={() => void handleOnnxMicToggle()}
            >
              {onnxMicRecording ? "Stop Mic Recording" : "1. Record Mic Phrase"}
            </button>

            <label className="btn" style={{ cursor: "pointer" }}>
              1. Or Upload Speech (.wav/.mp3)
              <input type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => void handleFileUpload(e)} />
            </label>

            <button
              type="button"
              className="btn btn-primary"
              disabled={onnxBusy}
              onClick={() => void handleRunOnnxConvert()}
            >
              {onnxBusy ? "Synthesizing Neural RVC..." : "2. Convert Voice with Neural ONNX"}
            </button>
          </div>

          <div style={{ marginTop: "10px", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <span className="mono">{onnxStatus}</span>
          </div>

          {onnxResultUrl && (
            <div
              className="form-row"
              style={{
                marginTop: "12px",
                padding: "10px 12px",
                background: "var(--panel-raised)",
                borderRadius: "6px",
                border: "1px solid var(--line)",
              }}
            >
              <span className="mono" style={{ fontSize: "0.82rem" }}>
                Neural ONNX Output ({onnxCustomName || selectedOnnxId})
              </span>
              <audio controls src={onnxResultUrl} style={{ height: "34px", flex: "1 1 220px" }} />
              <a
                className="btn btn-primary"
                href={onnxResultUrl}
                download={`neural_${(onnxCustomName || selectedOnnxId).replace(/[^a-zA-Z0-9_-]/g, "_")}.wav`}
              >
                Download Neural WAV
              </a>
            </div>
          )}
        </section>
      ) : mode === "browser" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>In-Browser DSP Pitch &amp; Formant Shaper ({VOICE_PRESETS.length} Presets)</h2>
            <span className="badge">AudioWorklet Pitch/EQ Only · Zero Downloads</span>
          </div>

          <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Adjusts pitch semitones and formant EQ in real time without neural voice cloning. For real anime character
            timbre, use <strong>Browser Neural (ONNX)</strong> or <strong>AI Server Bridge</strong>.
          </p>

          <div className="preset-toolbar">
            <input
              type="search"
              aria-label="Filter browser DSP presets"
              className="text-input preset-search"
              placeholder="Filter DSP presets..."
              value={presetQuery}
              onChange={(e) => setPresetQuery(e.target.value)}
            />
          </div>

          <div className="preset-grid">
            {filteredPresets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={`preset-card ${activePresetId === preset.id ? "active" : ""}`}
                onClick={() => applyPreset(preset.id)}
              >
                <div className="preset-top">
                  <span className="preset-name">{preset.name}</span>
                  <span className="badge mono">{preset.badge}</span>
                </div>
                <div className="preset-desc">{preset.description}</div>
              </button>
            ))}
          </div>

          <div className="controls-grid">
            <div className="slider-field">
              <div className="slider-head">
                <span>Pitch Shift</span>
                <strong className="mono">
                  {params.semitones >= 0 ? "+" : ""}
                  {params.semitones.toFixed(1)} st
                </strong>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={params.semitones}
                onChange={(e) => updateParams({ semitones: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Formant Resonance Shift</span>
                <strong className="mono">
                  {params.formantShift >= 0 ? "+" : ""}
                  {params.formantShift.toFixed(1)}
                </strong>
              </div>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.5}
                value={params.formantShift}
                onChange={(e) => updateParams({ formantShift: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Noise Gate Threshold</span>
                <strong className="mono">{params.gateThresholdDb <= -79 ? "Off" : `${params.gateThresholdDb} dB`}</strong>
              </div>
              <input
                type="range"
                min={-80}
                max={-20}
                step={1}
                value={params.gateThresholdDb}
                onChange={(e) => updateParams({ gateThresholdDb: Number(e.target.value) })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>High-Pass Cut (Rumble)</span>
                <strong className="mono">{params.highpassHz} Hz</strong>
              </div>
              <input
                type="range"
                min={30}
                max={320}
                step={5}
                value={params.highpassHz}
                onChange={(e) => updateParams({ highpassHz: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Clarity Presence EQ</span>
                <strong className="mono">
                  {params.presenceDb >= 0 ? "+" : ""}
                  {params.presenceDb.toFixed(1)} dB
                </strong>
              </div>
              <input
                type="range"
                min={-6}
                max={10}
                step={0.5}
                value={params.presenceDb}
                onChange={(e) => updateParams({ presenceDb: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Wet / Dry Mix</span>
                <strong className="mono">{Math.round(params.wetMix * 100)}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.wetMix}
                onChange={(e) => updateParams({ wetMix: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Holo Synth / Robotize</span>
                <strong className="mono">{Math.round(params.robotMix * 100)}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.robotMix}
                onChange={(e) => updateParams({ robotMix: Number(e.target.value), bypass: false })}
              />
            </div>

            <div className="slider-field">
              <div className="slider-head">
                <span>Echo / Space</span>
                <strong className="mono">{Math.round(params.echoMix * 100)}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.02}
                value={params.echoMix}
                onChange={(e) => updateParams({ echoMix: Number(e.target.value), bypass: false })}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>VC Client AI Server Bridge (RVC · DDSP-SVC · so-vits-svc · MMVC · Beatrice)</h2>
            <span className={`badge ${serverInfo ? "ok" : "warn"}`}>
              {serverInfo ? `Connected · Slot ${serverInfo.modelSlotIndex ?? "?"}` : "Disconnected"}
            </span>
          </div>

          <div className="form-row">
            <div className="input-group">
              <label htmlFor="vc-server-url">Server URL</label>
              <input
                id="vc-server-url"
                type="url"
                className="text-input mono"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://127.0.0.1:18888"
              />
            </div>
            <div className="input-group">
              <label htmlFor="vc-access-token">Access Token (if server uses --access-token)</label>
              <input
                id="vc-access-token"
                type="password"
                className="text-input mono"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Optional bearer token"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={serverConnecting}
              onClick={() => void handleConnectServer()}
            >
              {serverConnecting ? "Connecting..." : "Connect & Sync"}
            </button>
            {validServerHref && (
              <a className="btn" href={validServerHref} target="_blank" rel="noopener noreferrer">
                Open Server UI
              </a>
            )}
          </div>

          <div className="code-cmd mono" style={{ marginTop: "12px" }}>
            <span>Windows: {corsOriginCommand}</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(corsOriginCommand);
                setCopiedCmd(true);
                setTimeout(() => setCopiedCmd(false), 1800);
              }}
            >
              {copiedCmd ? "Copied" : "Copy Windows Flag"}
            </button>
          </div>
          <div className="code-cmd mono" style={{ marginTop: "6px" }}>
            <span>Linux/macOS: $ {linuxCorsOriginCommand}</span>
          </div>

          {serverHealth && (
            <div style={{ marginTop: "10px", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Health: modelLoaded={String(serverHealth.modelLoaded)} · serverAudioStarted=
              {String(serverHealth.serverAudioStarted)} · uptime={Math.round(serverHealth.uptimeSeconds ?? 0)}s
            </div>
          )}

          {serverInfo && (
            <>
              <div className="controls-grid">
                <div className="slider-field">
                  <div className="slider-head">
                    <span>AI Pitch Tune (tran)</span>
                    <strong className="mono">{serverInfo.tran ?? 0} st</strong>
                  </div>
                  <input
                    type="range"
                    min={-24}
                    max={24}
                    step={1}
                    value={serverInfo.tran ?? 0}
                    onChange={(e) => void handleServerSetting("tran", Number(e.target.value))}
                  />
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                    <button type="button" className="btn" style={{ padding: "2px 7px", fontSize: "0.72rem" }} onClick={() => void handleServerSetting("tran", 12)}>
                      +12 Deep-&gt;Fem
                    </button>
                    <button type="button" className="btn" style={{ padding: "2px 7px", fontSize: "0.72rem" }} onClick={() => void handleServerSetting("tran", 0)}>
                      0 Match
                    </button>
                    <button type="button" className="btn" style={{ padding: "2px 7px", fontSize: "0.72rem" }} onClick={() => void handleServerSetting("tran", -12)}>
                      -12 Fem-&gt;Deep
                    </button>
                  </div>
                </div>

                <div className="slider-field">
                  <div className="slider-head">
                    <span>Index Ratio</span>
                    <strong className="mono">{(serverInfo.indexRatio ?? 0).toFixed(2)}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={serverInfo.indexRatio ?? 0}
                    onChange={(e) => void handleServerSetting("indexRatio", Number(e.target.value))}
                  />
                </div>

                <div className="slider-field">
                  <div className="slider-head">
                    <span>Consonant Protect</span>
                    <strong className="mono">{(serverInfo.protect ?? 0.5).toFixed(2)}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.05}
                    value={serverInfo.protect ?? 0.5}
                    onChange={(e) => void handleServerSetting("protect", Number(e.target.value))}
                  />
                </div>

                <div className="slider-field">
                  <div className="slider-head">
                    <span>F0 Pitch Extractor</span>
                    <strong className="mono">{serverInfo.f0Detector ?? "rmvpe"}</strong>
                  </div>
                  <select
                    className="select-input"
                    value={serverInfo.f0Detector ?? "rmvpe"}
                    onChange={(e) => void handleServerSetting("f0Detector", e.target.value)}
                  >
                    <option value="rmvpe_onnx">rmvpe_onnx</option>
                    <option value="rmvpe">rmvpe</option>
                    <option value="fcpe">fcpe</option>
                    <option value="crepe_tiny">crepe_tiny</option>
                    <option value="crepe_full">crepe_full</option>
                    <option value="pm">pm</option>
                    <option value="harvest">harvest</option>
                  </select>
                </div>
              </div>

              {activeSlots.length > 0 && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", margin: "16px 0 4px", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "0.86rem" }}>Loaded Model Slots</h3>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                      disabled={exportingOnnx}
                      onClick={() => void handleExportSlotToBrowserOnnx()}
                    >
                      {exportingOnnx ? "Exporting ONNX..." : "Export Active Slot -> Browser .onnx"}
                    </button>
                  </div>
                  <div className="slots-grid">
                    {activeSlots.map((slot) => (
                      <button
                        type="button"
                        key={String(slot.slotIndex)}
                        className={`preset-card ${serverInfo.modelSlotIndex === slot.slotIndex ? "active" : ""}`}
                        onClick={() => void handleServerSetting("modelSlotIndex", slot.slotIndex)}
                      >
                        <div className="preset-top">
                          <span className="preset-name">{slot.name || `Slot ${slot.slotIndex}`}</span>
                          <span className="badge mono">{slot.voiceChangerType || "Model"}</span>
                        </div>
                        <div className="preset-desc mono">Slot #{slot.slotIndex}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {Object.keys(serverPresets).length > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "0.86rem" }}>Server Presets</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {Object.keys(serverPresets).map((presetName) => (
                      <button
                        type="button"
                        key={presetName}
                        className="btn"
                        onClick={() => void serverClientRef.current?.applyPreset(presetName).then(setServerInfo)}
                      >
                        Apply: {presetName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {soundboardFiles.length > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "0.86rem" }}>Soundboard</h3>
                    {soundboardStatus?.active && <span className="badge ok">Playing</span>}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void serverClientRef.current?.stopSounds()}
                    >
                      Stop All
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {soundboardFiles.map((file) => (
                      <button
                        type="button"
                        key={file}
                        className="btn"
                        onClick={() => void serverClientRef.current?.playSound(file)}
                      >
                        Play {file}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px dashed var(--line)" }}>
            <div className="preset-toolbar">
              <div>
                <h3 style={{ margin: "0 0 2px", fontSize: "0.92rem" }}>
                  AI RVC Sound Model Catalog &amp; .zip Slot Installer
                </h3>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Downloads verified RVC v2 checkpoints (.zip / .pth + .index) into your connected VC Client server slot.
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <label style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Slot
                  <select
                    aria-label="Target model slot"
                    className="select-input"
                    style={{ width: "auto", marginLeft: "6px", padding: "5px 8px" }}
                    value={targetSlot}
                    onChange={(e) => setTargetSlot(Number(e.target.value))}
                  >
                    {Array.from({ length: 10 }, (_, idx) => {
                      const existing = serverInfo?.modelSlots?.find((s) => Number(s.slotIndex) === idx);
                      const suffix = existing?.modelFile ? ` · ${existing.name || existing.modelFile}` : " · empty";
                      return (
                        <option key={idx} value={idx}>
                          #{idx}
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.78rem" }}>
                  <input
                    type="checkbox"
                    checked={useIndexOnInstall}
                    onChange={(e) => setUseIndexOnInstall(e.target.checked)}
                  />
                  Use .index
                </label>

                <label className="btn" style={{ cursor: serverInfo ? "pointer" : "not-allowed", opacity: serverInfo ? 1 : 0.55 }}>
                  {uploadProgress || "Upload .zip / .pth + .index"}
                  <input
                    type="file"
                    accept=".zip,.pth,.onnx,.index"
                    multiple
                    disabled={!serverInfo || Boolean(uploadProgress)}
                    style={{ display: "none" }}
                    onChange={(e) => void handleUploadLocalModel(e)}
                  />
                </label>

                <input
                  type="search"
                  aria-label="Search RVC catalog"
                  className="text-input"
                  style={{ width: "210px", padding: "6px 10px" }}
                  placeholder="Search RVC catalog..."
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                />
              </div>
            </div>

            {serverNote && (
              <div className="badge ok" style={{ display: "inline-block", marginBottom: "10px", textTransform: "none" }}>
                {serverNote}
              </div>
            )}

            <div className="slots-grid">
              {aiCatalog.map((sample) => {
                const safeDownloadHref =
                  sample.modelUrl && /^https?:\/\//i.test(sample.modelUrl) ? sample.modelUrl : null;
                const safeCardHref =
                  sample.termsOfUseUrl && /^https?:\/\//i.test(sample.termsOfUseUrl) ? sample.termsOfUseUrl : null;
                const isBusy = busySampleId === sample.id;
                return (
                  <div key={sample.id} className="catalog-card">
                    <div>
                      <div className="preset-top">
                        <span className="preset-name">{sample.name}</span>
                        <span className="badge mono">{sample.voiceChangerType || "RVC"}</span>
                      </div>
                      <div className="preset-desc">
                        {sample.description || "Neural voice conversion model"}
                        {sample.credit ? ` · by ${sample.credit}` : ""}
                      </div>
                    </div>
                    <div className="catalog-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                        disabled={!serverInfo || Boolean(busySampleId)}
                        onClick={() => void handleInstallSample(sample)}
                        title={
                          serverInfo
                            ? `Download & load ${sample.name} into slot #${targetSlot}`
                            : "Connect to your VC Client server above to install"
                        }
                      >
                        {isBusy ? "Installing..." : serverInfo ? `Install -> #${targetSlot}` : "Needs Server"}
                      </button>
                      <div style={{ display: "flex", gap: "8px", fontSize: "0.74rem" }}>
                        {safeDownloadHref && (
                          <a href={safeDownloadHref} target="_blank" rel="noopener noreferrer">
                            .zip
                          </a>
                        )}
                        {safeCardHref && (
                          <a href={safeCardHref} target="_blank" rel="noopener noreferrer">
                            HF
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Run Full GPU / Neural Engines Locally</h2>
          <span className="badge">RVC · DDSP-SVC · so-vits-svc · MMVC · Beatrice · LLVC</span>
        </div>
        <div className="desktop-grid">
          <div>
            <p style={{ margin: "0 0 10px", fontSize: "0.86rem", color: "var(--text-muted)" }}>
              Run heavy PyTorch / ONNX neural voice conversion models on your local CPU or GPU, then connect this web
              studio or use the bundled local UI.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <a
                className="btn btn-primary"
                href="https://github.com/NimuthuGanegoda/voice-changer/releases/latest/download/VoiceChanger.exe"
              >
                Download Windows EXE
              </a>
              <a className="btn" href="https://github.com/NimuthuGanegoda/voice-changer">
                GitHub Repository
              </a>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="code-cmd mono">$ bash start_local.sh</div>
            <div className="code-cmd mono">&gt; start_local.bat</div>
          </div>
        </div>
        <div className="footer-links">
          <a href="https://github.com/NimuthuGanegoda/voice-changer/blob/master/README.md">Documentation</a>
          <a href="https://github.com/NimuthuGanegoda/voice-changer/releases">Releases</a>
          <a href="https://github.com/NimuthuGanegoda/voice-changer/blob/master/.github/FAQ.md">FAQ</a>
        </div>
      </section>
    </div>
  );
}
