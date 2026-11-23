import React, { useMemo, useState } from "react";
import { useAppState } from "../../../001_provider/001_AppStateProvider";
import { useGuiState } from "../001_GuiStateProvider";
import { AUDIO_ELEMENT_FOR_SAMPLING_INPUT, AUDIO_ELEMENT_FOR_SAMPLING_OUTPUT } from "../../../const";

export type RecorderAreaProps = {};

export const RecorderArea = (_props: RecorderAreaProps) => {
    const { serverSetting, webEdition } = useAppState();
    const { audioOutputForAnalyzer, setAudioOutputForAnalyzer, outputAudioDeviceInfo } = useGuiState();
    const [serverIORecording, setServerIORecording] = useState<boolean>(false);

    const serverIORecorderRow = useMemo(() => {
        if (webEdition) {
            return <> </>;
        }
        const applySinkId = (el: HTMLAudioElement | null, sinkId: string) => {
            if (!el || !sinkId || sinkId === "none") {
                return;
            }
            const audioEl = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
            if (typeof audioEl.setSinkId === "function") {
                Promise.resolve(audioEl.setSinkId(sinkId)).catch((e) => {
                    console.log(e);
                });
            }
        };

        const onServerIORecordStartClicked = async () => {
            try {
                await serverSetting.updateServerSettings({ ...serverSetting.serverSetting, recordIO: 1 });
                setServerIORecording(true);
            } catch (e) {
                console.log(e);
            }
        };
        const onServerIORecordStopClicked = async () => {
            try {
                await serverSetting.updateServerSettings({ ...serverSetting.serverSetting, recordIO: 0 });
            } catch (e) {
                console.log(e);
            }
            setServerIORecording(false);

            // set wav (input)
            const wavInput = document.getElementById(AUDIO_ELEMENT_FOR_SAMPLING_INPUT) as HTMLAudioElement | null;
            if (wavInput) {
                wavInput.src = "/tmp/in.wav?" + new Date().getTime();
                wavInput.controls = true;
                applySinkId(wavInput, audioOutputForAnalyzer);
            }

            // set wav (output)
            const wavOutput = document.getElementById(AUDIO_ELEMENT_FOR_SAMPLING_OUTPUT) as HTMLAudioElement | null;
            if (wavOutput) {
                wavOutput.src = "/tmp/out.wav?" + new Date().getTime();
                wavOutput.controls = true;
                applySinkId(wavOutput, audioOutputForAnalyzer);
            }
        };

        const startClassName = serverIORecording ? "config-sub-area-button-active" : "config-sub-area-button";
        const stopClassName = serverIORecording ? "config-sub-area-button" : "config-sub-area-button-active";
        return (
            <>
                <div className="config-sub-area-control">
                    <div className="config-sub-area-control-title-long">ServerIO Analyzer</div>
                </div>

                <div className="config-sub-area-control left-padding-1">
                    <div className="config-sub-area-control-title">SIO rec.</div>
                    <div className="config-sub-area-control-field">
                        <div className="config-sub-area-buttons">
                            <div onClick={onServerIORecordStartClicked} className={startClassName}>
                                start
                            </div>
                            <div onClick={onServerIORecordStopClicked} className={stopClassName}>
                                stop
                            </div>
                        </div>
                    </div>
                </div>

                <div className="config-sub-area-control left-padding-1">
                    <div className="config-sub-area-control-title">output</div>
                    <div className="config-sub-area-control-field">
                        <div className="config-sub-area-control-field-auido-io">
                            <select
                                className="body-select"
                                value={audioOutputForAnalyzer}
                                onChange={(e) => {
                                    setAudioOutputForAnalyzer(e.target.value);
                                    const wavInput = document.getElementById(AUDIO_ELEMENT_FOR_SAMPLING_INPUT) as HTMLAudioElement | null;
                                    const wavOutput = document.getElementById(AUDIO_ELEMENT_FOR_SAMPLING_OUTPUT) as HTMLAudioElement | null;
                                    applySinkId(wavInput, e.target.value);
                                    applySinkId(wavOutput, e.target.value);
                                }}
                            >
                                {outputAudioDeviceInfo
                                    .map((x) => {
                                        if (x.deviceId == "none") {
                                            return null;
                                        }
                                        return (
                                            <option key={x.deviceId} value={x.deviceId}>
                                                {x.label}
                                            </option>
                                        );
                                    })
                                    .filter((x) => {
                                        return x != null;
                                    })}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="config-sub-area-control left-padding-1">
                    <div className="config-sub-area-control-title">in</div>
                    <div className="config-sub-area-control-field">
                        <div className="config-sub-area-control-field-wav-file">
                            <div className="config-sub-area-control-field-wav-file-audio-container">
                                <audio className="config-sub-area-control-field-wav-file-audio" id={AUDIO_ELEMENT_FOR_SAMPLING_INPUT} controls></audio>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="config-sub-area-control left-padding-1">
                    <div className="config-sub-area-control-title">out</div>
                    <div className="config-sub-area-control-field">
                        <div className="config-sub-area-control-field-wav-file">
                            <div className="config-sub-area-control-field-wav-file-audio-container">
                                <audio className="config-sub-area-control-field-wav-file-audio" id={AUDIO_ELEMENT_FOR_SAMPLING_OUTPUT} controls></audio>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }, [serverIORecording, audioOutputForAnalyzer, outputAudioDeviceInfo, serverSetting.serverSetting, serverSetting.updateServerSettings]);

    return <div className="config-sub-area">{serverIORecorderRow}</div>;
};
