import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../../001_provider/001_AppStateProvider";

export type SoundboardAreaProps = {};
type TtsVoice = { id: string; name: string; languages: string[] };

export const SoundboardArea = (_props: SoundboardAreaProps) => {
    const { serverSetting, webEdition } = useAppState();
    const [files, setFiles] = useState<string[]>([]);
    const [voices, setVoices] = useState<TtsVoice[]>([]);
    const [voice, setVoice] = useState<string>("");
    const [ttsRate, setTtsRate] = useState<string>("");
    const [ttsText, setTtsText] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const soundboardVolume = serverSetting.serverSetting.soundboardVolume ?? 1.0;
    const soundboardBypass = Boolean(serverSetting.serverSetting.soundboardBypass);

    const reloadList = async () => {
        try {
            const res = await serverSetting.getSoundboardList();
            setFiles(res.files ?? []);
        } catch (error) {
            console.error("Could not load soundboard", error);
        }
    };

    useEffect(() => {
        reloadList();
        serverSetting.getTtsVoices().then(res => setVoices(res.voices ?? [])).catch(error => {
            console.warn("Local TTS voices are unavailable", error);
            setVoices([]);
        });
    }, []);

    const soundboardRow = useMemo(() => {
        const run = async (action: () => Promise<unknown>) => {
            if (busy) return;
            setBusy(true);
            try {
                await action();
            } catch (error) {
                alert(error instanceof Error ? error.message : String(error));
            } finally {
                setBusy(false);
            }
        };
        const onSoundClicked = (filename: string) => run(() => serverSetting.playSound(filename));
        const onDeleteClicked = (filename: string) => {
            if (!window.confirm(`Delete soundboard clip "${filename}"?`)) return;
            run(async () => {
                await serverSetting.deleteSound(filename);
                await reloadList();
            });
        };
        const onUploadClicked = () => fileInputRef.current?.click();
        const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            run(async () => {
                await serverSetting.uploadSoundboardFile(file);
                await reloadList();
            });
        };
        const onTtsClicked = () => {
            if (!ttsText.trim()) return;
            const parsedRate = ttsRate ? Number(ttsRate) : undefined;
            run(() => serverSetting.tts(ttsText, voice, parsedRate));
        };
        const onStopClicked = () => run(() => serverSetting.stopSounds());
        const onVolumeChanged = (val: number) =>
            run(() => serverSetting.updateServerSettings({ ...serverSetting.serverSetting, soundboardVolume: val }));
        const onBypassToggled = () =>
            run(() => serverSetting.updateServerSettings({ ...serverSetting.serverSetting, soundboardBypass: !soundboardBypass }));

        return (
            <div className="config-sub-area-control left-padding-1">
                <div className="config-sub-area-control-title">Sounds:</div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <div className="config-sub-area-buttons">
                        {files.map((f) => (
                            <div key={f} className="config-sub-area-button" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <span onClick={() => !busy && onSoundClicked(f)}>{f}</span>
                                <button type="button" aria-label={`Delete ${f}`} disabled={busy} onClick={() => onDeleteClicked(f)} style={{ border: 0, background: "transparent", cursor: "pointer" }}>×</button>
                            </div>
                        ))}
                        <div className="config-sub-area-button" onClick={() => !busy && onUploadClicked()}>+ add</div>
                        <div className="config-sub-area-button" onClick={() => !busy && onStopClicked()}>stop</div>
                        <div
                            className={soundboardBypass ? "config-sub-area-button-active" : "config-sub-area-button"}
                            title="Direct SFX mixes clips after voice conversion; Convert Voice feeds clips through the AI voice"
                            onClick={() => !busy && onBypassToggled()}
                        >
                            {soundboardBypass ? "direct sfx" : "convert voice"}
                        </div>
                        <input ref={fileInputRef} type="file" accept=".wav,.mp3,.ogg,.flac,.m4a,audio/*" hidden onChange={onFileSelected} />
                    </div>
                </div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>vol</span>
                        <input
                            type="range"
                            min="0.0"
                            max="2.0"
                            step="0.05"
                            aria-label="Soundboard volume"
                            value={soundboardVolume}
                            onChange={(e) => onVolumeChanged(Number(e.target.value))}
                        />
                        <span>{soundboardVolume.toFixed(2)}</span>
                    </label>
                </div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <input
                        className="body-select"
                        type="text"
                        maxLength={500}
                        placeholder="Type text to speak..."
                        value={ttsText}
                        onChange={(e) => setTtsText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onTtsClicked();
                        }}
                    />
                    <select className="body-select" value={voice} onChange={e => setVoice(e.target.value)} aria-label="TTS voice">
                        <option value="">default voice</option>
                        {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <select className="body-select" value={ttsRate} onChange={e => setTtsRate(e.target.value)} aria-label="TTS speed">
                        <option value="">1.0x</option>
                        <option value="130">0.75x</option>
                        <option value="225">1.25x</option>
                        <option value="275">1.5x</option>
                    </select>
                    <div className="config-sub-area-button" onClick={() => !busy && onTtsClicked()}>{busy ? "..." : "speak"}</div>
                </div>
            </div>
        );
    }, [files, voices, voice, ttsRate, ttsText, busy, serverSetting, soundboardVolume, soundboardBypass]);

    if (webEdition) return <></>;
    return <div className="config-sub-area">{soundboardRow}</div>;
};
