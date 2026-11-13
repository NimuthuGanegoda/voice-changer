import { useMemo, useEffect } from "react";

import { VoiceChangerClientSetting } from "../const";
import { VoiceChangerClient } from "../VoiceChangerClient";

export type UseClientSettingProps = {
    voiceChangerClient: VoiceChangerClient | null;
    voiceChangerClientSetting: VoiceChangerClientSetting;
};

export type ClientSettingState = {
    setServerUrl: (url: string) => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    reloadClientSetting: () => Promise<void>;
};

export const useClientSetting = (props: UseClientSettingProps): ClientSettingState => {
    useEffect(() => {
        if (!props.voiceChangerClient) return;
        props.voiceChangerClient.updateClientSetting(props.voiceChangerClientSetting)
            .catch(error => console.error("Could not apply client settings", error));
    }, [props.voiceChangerClient, props.voiceChangerClientSetting]);

    const setServerUrl = useMemo(() => {
        return (url: string) => {
            if (!props.voiceChangerClient) return;
            props.voiceChangerClient.setServerUrl(url, true);
        };
    }, [props.voiceChangerClient]);

    //////////////
    // 操作
    /////////////
    // (1) start
    const start = useMemo(() => {
        return async () => {
            if (!props.voiceChangerClient) return;
            await props.voiceChangerClient.start();
        };
    }, [props.voiceChangerClient]);
    // (2) stop
    const stop = useMemo(() => {
        return async () => {
            if (!props.voiceChangerClient) return;
            await props.voiceChangerClient.stop();
        };
    }, [props.voiceChangerClient]);
    const reloadClientSetting = useMemo(() => {
        return async () => {
            if (!props.voiceChangerClient) return;
            await props.voiceChangerClient.getClientSettings();
        };
    }, [props.voiceChangerClient]);

    return {
        setServerUrl,

        start,
        stop,
        reloadClientSetting,
    };
};
