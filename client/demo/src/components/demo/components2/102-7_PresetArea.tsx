import React, { useEffect, useMemo, useState } from "react";
import { VoicePresetMap } from "@dannadori/voice-changer-client-js";
import { useAppState } from "../../../001_provider/001_AppStateProvider";

export type PresetAreaProps = {};

export const PresetArea = (_props: PresetAreaProps) => {
    const { serverSetting, webEdition } = useAppState();
    const [presets, setPresets] = useState<VoicePresetMap>({});
    const [presetName, setPresetName] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);

    const reloadPresets = async () => {
        try {
            const res = await serverSetting.getPresets();
            setPresets(res.presets ?? {});
        } catch (error) {
            console.warn("Could not load voice presets", error);
        }
    };

    useEffect(() => {
        reloadPresets();
    }, []);

    const presetRow = useMemo(() => {
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

        const onSaveClicked = () => {
            const cleaned = presetName.trim();
            if (!cleaned) return;
            run(async () => {
                await serverSetting.savePreset(cleaned);
                setPresetName("");
                await reloadPresets();
            });
        };

        const onApplyClicked = (name: string) =>
            run(async () => {
                await serverSetting.applyPreset(name);
            });

        const onDeleteClicked = (name: string) => {
            if (!window.confirm(`Delete voice preset "${name}"?`)) return;
            run(async () => {
                await serverSetting.deletePreset(name);
                await reloadPresets();
            });
        };

        const names = Object.keys(presets).sort();

        return (
            <div className="config-sub-area-control left-padding-1">
                <div className="config-sub-area-control-title">Presets:</div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <div className="config-sub-area-buttons">
                        {names.map((name) => (
                            <div key={name} className="config-sub-area-button" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <span onClick={() => !busy && onApplyClicked(name)}>{name}</span>
                                <button
                                    type="button"
                                    aria-label={`Delete preset ${name}`}
                                    disabled={busy}
                                    onClick={() => onDeleteClicked(name)}
                                    style={{ border: 0, background: "transparent", cursor: "pointer" }}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <input
                        className="body-select"
                        type="text"
                        maxLength={64}
                        placeholder="New preset name..."
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onSaveClicked();
                        }}
                    />
                    <div className="config-sub-area-button" onClick={() => !busy && onSaveClicked()}>
                        {busy ? "..." : "save"}
                    </div>
                </div>
            </div>
        );
    }, [presets, presetName, busy, serverSetting]);

    if (webEdition) return <></>;
    return <div className="config-sub-area">{presetRow}</div>;
};
