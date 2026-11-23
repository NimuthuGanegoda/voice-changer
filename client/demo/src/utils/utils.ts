export const trimfileName = (name: string, length: number) => {
    const trimmedName = name.replace(/^.*[\\/]/, "");
    if (trimmedName.length > length) {
        return trimmedName.substring(0, length) + "...";
    } else {
        return trimmedName;
    }
};

export const checkExtention = (filename: string, acceptExtentions: string[]) => {
    if (!filename.includes(".")) {
        return false;
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext) {
        return false;
    }
    return acceptExtentions.some((allowed) => allowed.toLowerCase() === ext);
};