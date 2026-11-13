import { fileSelector } from "./util";

describe("fileSelector", () => {
    afterEach(() => jest.restoreAllMocks());

    const selectFile = (file: File) => {
        jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
            Object.defineProperty(this, "files", { value: [file], configurable: true });
            this.onchange?.({ target: this } as unknown as Event);
        });
    };

    test("accepts a matching MIME type and rejects a non-matching one", async () => {
        selectFile(new File(["image"], "icon.png", { type: "image/png" }));
        await expect(fileSelector("image/.*")).resolves.toHaveProperty("name", "icon.png");
        selectFile(new File(["text"], "notes.txt", { type: "text/plain" }));
        await expect(fileSelector("image/.*")).rejects.toContain("not target file type");
    });

    test("cancelling the picker rejects instead of hanging", async () => {
        jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
            this.dispatchEvent(new Event("cancel"));
        });
        await expect(fileSelector("")).rejects.toBe("no file selected");
    });
});
