import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../../001_provider/001_AppStateProvider";

export type SoundboardAreaProps = {};

export const SoundboardArea = (_props: SoundboardAreaProps) => {
    const { serverSetting, webEdition } = useAppState();
    const [files, setFiles] = useState<string[]>([]);
    const [ttsText, setTtsText] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reloadList = async () => {
        const res = await serverSetting.getSoundboardList();
        setFiles(res.files ?? []);
    };

    useEffect(() => {
        reloadList();
    }, []);

    const soundboardRow = useMemo(() => {
        const onSoundClicked = async (filename: string) => {
            await serverSetting.playSound(filename);
        };

        const onUploadClicked = () => {
            fileInputRef.current?.click();
        };

        const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
                await serverSetting.uploadSoundboardFile(file);
                await reloadList();
            } finally {
                setBusy(false);
                e.target.value = "";
            }
        };

        const onTtsClicked = async () => {
            if (!ttsText.trim()) return;
            setBusy(true);
            try {
                await serverSetting.tts(ttsText);
            } finally {
                setBusy(false);
            }
        };

        return (
            <div className="config-sub-area-control left-padding-1">
                <div className="config-sub-area-control-title">Sounds:</div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <div className="config-sub-area-buttons">
                        {files.map((f) => (
                            <div key={f} className="config-sub-area-button" onClick={() => onSoundClicked(f)}>
                                {f}
                            </div>
                        ))}
                        <div className="config-sub-area-button" onClick={onUploadClicked}>
                            + add
                        </div>
                        <input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={onFileSelected} />
                    </div>
                </div>
                <div className="config-sub-area-control-field config-sub-area-control-field-long">
                    <input
                        className="body-select"
                        type="text"
                        placeholder="Type text to speak..."
                        value={ttsText}
                        onChange={(e) => setTtsText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onTtsClicked();
                        }}
                    />
                    <div className="config-sub-area-button" onClick={onTtsClicked}>
                        {busy ? "..." : "speak"}
                    </div>
                </div>
            </div>
        );
    }, [files, ttsText, busy]);

    if (webEdition) {
        return <></>;
    }
    return <div className="config-sub-area">{soundboardRow}</div>;
};
