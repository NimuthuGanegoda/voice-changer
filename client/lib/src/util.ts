export const createDummyMediaStream = (audioContext: AudioContext) => {
    // A destination with no connected source is a silent, live MediaStream. The old
    // oscillator was never stopped and leaked a running audio graph per setup.
    return audioContext.createMediaStreamDestination().stream;
};

export const fileSelector = async (regex: string) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    const p = new Promise<File>((resolve, reject) => {
        fileInput.onchange = (e) => {
            if (e.target instanceof HTMLInputElement == false) {
                console.log("invalid target!", e.target);
                reject("invalid target");
                return null;
            }
            const target = e.target as HTMLInputElement;
            if (!target.files || target.files.length == 0) {
                reject("no file selected");
                return null;
            }

            if (regex != "" && !target.files[0].type.match(regex)) {
                reject(`not target file type ${target.files[0].type}`);
                return null;
            }
            resolve(target.files[0]);
            return null;
        };
        fileInput.addEventListener("cancel", () => reject("no file selected"), { once: true });
        fileInput.click();
    });
    return await p;
};

export const fileSelectorAsDataURL = async (regex: string) => {
    const f = await fileSelector(regex);
    if (!f) {
        return f;
    }

    const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
        reader.readAsDataURL(f);
    });
    return url;
};

export const validateUrl = (url: string) => {
    if (url?.endsWith("/")) {
        return url.substring(0, url.length - 1);
    }
    return url;
};
