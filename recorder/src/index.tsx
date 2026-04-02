import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppStateProvider } from "./003_provider/AppStateProvider";
import { AppSettingProvider, useAppSetting } from "./003_provider/AppSettingProvider";

import "./100_components/001_css/001_App.css";


const AppStateProviderWrapper = () => {
    const { applicationSetting, deviceManagerState } = useAppSetting();
    const [firstTouch, setFirstTouch] = React.useState<boolean>(false);

    if (!applicationSetting || !firstTouch) {
        const clearSetting = () => {
            const result = window.confirm('Settings will be reset.');
            if (result) {
                applicationSetting.clearSetting()
                location.reload()
            }
        }
        return (
            <div className="front-container">
                <div className="front-title">Corpus Voice Recorder</div>
                <div className="front-description">
                    <p>This is a voice recording app for speech synthesis.</p>
                    <p>Fully client-side. No data upload to servers. Data stored locally in browser.</p>
                    <p>
                        Source code and instructions are available 
                        <a href="https://github.com/w-okada/voice-changer" target="_blank" rel="noopener noreferrer"> here.</a>
                    </p>
                    <p className="front-description-strong">If you feel like buying me a coffee, support me here: </p>
                    <p>
                        <a href="https://www.buymeacoffee.com/wokad">
                            <img className="front-description-img" src="./coffee.png"></img>
                        </a>
                    </p>
                    <a></a>
                </div>
                <div
                    className="front-start-button front-start-button-color"
                    onClick={() => {
                        setFirstTouch(true);
                    }}
                >
                    Click to start
                </div>
                <div className="front-note">Tested on: Windows 11 + Chrome</div>
                <div className="front-description">
                    <p>Currently registered with ITA corpus emotion and recitation scripts.</p>
                    <p>
                        Designed for use with 
                        <a href="https://github.com/isletennos/MMVC_Trainer" target="_blank">
                            MMVC
                        </a>
                        , so recording is set to 48000Hz, 16bit.
                    </p>
                    <p>
                        (Internally converted to 24000Hz during export.)
                    </p>

                </div>


                {/* <div className="front-attention">
                    <p>Please start with a small amount of use and export frequently for operation confirmation.</p>
                    <p>Data will be lost if you clear your browser data.</p>
                </div> */}
                <div className="front-disclaimer">Disclaimer: We are not responsible for any direct, indirect, consequential, or special damages arising from the use or inability to use this software.</div>


                <div className="front-clear-setting" onClick={clearSetting}>
                    Clear Setting
                </div>
            </div>
        );
    } else if (deviceManagerState.audioInputDevices.length === 0) {
        return (
            <>
                <div className="start-button">Loading Devices...</div>
            </>
        );
    } else {
        return (
            <AppStateProvider>
                <App />
            </AppStateProvider>
        );
    }
};

const container = document.getElementById("app")!;
const root = createRoot(container);
root.render(
    <AppSettingProvider>
        <AppStateProviderWrapper></AppStateProviderWrapper>
    </AppSettingProvider>
);
