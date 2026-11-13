import { useMemo, useEffect } from "react";

import { WorkletNodeSetting } from "../const";
import { VoiceChangerClient } from "../VoiceChangerClient";
import { InternalCallback } from "../client/VoiceChangerWorkletNode";

export type UseWorkletNodeSettingProps = {
    voiceChangerClient: VoiceChangerClient | null;
    workletNodeSetting: WorkletNodeSetting;
};

export type WorkletNodeSettingState = {
    startOutputRecording: () => void;
    stopOutputRecording: () => Promise<Float32Array>;
    trancateBuffer: () => Promise<void>;
    setInternalAudioProcessCallback: (internalCallback: InternalCallback) => Promise<void>;
};

export const useWorkletNodeSetting = (props: UseWorkletNodeSettingProps): WorkletNodeSettingState => {
    useEffect(() => {
        if (!props.voiceChangerClient) return;
        props.voiceChangerClient.updateWorkletNodeSetting(props.workletNodeSetting);
    }, [props.voiceChangerClient, props.workletNodeSetting]);

    const startOutputRecording = useMemo(() => {
        return () => {
            if (!props.voiceChangerClient) return;
            props.voiceChangerClient.startOutputRecording();
        };
    }, [props.voiceChangerClient]);

    const stopOutputRecording = useMemo(() => {
        return async () => {
            if (!props.voiceChangerClient) return new Float32Array();
            return props.voiceChangerClient.stopOutputRecording();
        };
    }, [props.voiceChangerClient]);

    const trancateBuffer = useMemo(() => {
        return async () => {
            if (!props.voiceChangerClient) return;
            props.voiceChangerClient.trancateBuffer();
        };
    }, [props.voiceChangerClient]);

    const setInternalAudioProcessCallback = useMemo(() => {
        return async (internalCallback: InternalCallback) => {
            if (!props.voiceChangerClient) return;
            props.voiceChangerClient.setInternalAudioProcessCallback(internalCallback);
        };
    }, [props.voiceChangerClient]);

    return {
        startOutputRecording,
        stopOutputRecording,
        trancateBuffer,
        setInternalAudioProcessCallback,
    };
};
