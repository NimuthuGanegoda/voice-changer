import { ServerRestClient, ServerRequestError } from "./ServerRestClient";

const jsonResponse = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body } as Response);

describe("ServerRestClient", () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock;
        Object.defineProperty(global, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" }, configurable: true });
    });

    test("rejects HTTP errors instead of hanging or returning error JSON as settings", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "ERROR", msg: "model failed" }, 500));
        const client = new ServerRestClient("http://server", "secret-token");
        await expect(client.getSettings()).rejects.toBeInstanceOf(ServerRequestError);
        const request = fetchMock.mock.calls[0][0] as RequestInfo;
        const init = fetchMock.mock.calls[0][1]!;
        expect(String(request)).toBe("http://server/info");
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-token");
    });

    test("uploads every chunk and only completes after concatenation", async () => {
        fetchMock.mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/upload_file")) return jsonResponse({ status: "OK" });
            if (url.endsWith("/concat_uploaded_file")) {
                const form = init!.body as FormData;
                expect(form.get("filenameChunkNum")).toBe("3");
                expect(form.get("original_filename")).toBe("model.pt");
                return jsonResponse({ status: "OK", name: "0123456789abcdef0123456789abcdef.pt" });
            }
            throw new Error(`unexpected URL ${url}`);
        });
        const client = new ServerRestClient("");
        const file = new File([new Uint8Array(2 * 1024 * 1024 + 5)], "model.pt");
        const progress: number[] = [];
        const result = await client.uploadFileWithId("model/", file, value => progress.push(value));
        expect(result.chunkNum).toBe(3);
        expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/upload_file"))).toHaveLength(3);
        expect(progress[progress.length - 1]).toBe(100);
    });

    test("a failed chunk rejects the upload", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "ERROR", msg: "disk full" }, 500));
        const client = new ServerRestClient("");
        await expect(client.uploadFile2("", new File(["data"], "model.pt"), jest.fn())).rejects.toThrow("disk full");
    });

    test("model load carries the selected slot and REST audio does not require Node Buffer", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ status: "OK", modelSlots: [] }));
        const client = new ServerRestClient("");
        await client.loadModel(7, false, '{"slot":7}');
        const form = fetchMock.mock.calls[0][1]!.body as FormData;
        expect(form.get("slot")).toBe("7");
        fetchMock.mockResolvedValueOnce(jsonResponse({ changedVoiceBase64: btoa("audio") }));
        const result = await client.postVoice(123, Uint8Array.from([105, 110, 112, 117, 116]).buffer);
        expect(String.fromCharCode(...new Uint8Array(result))).toBe("audio");
        expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body)).timestamp).toBe(123);
    });

    test("soundboard controls, TTS voices and model deletion use the new routes", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: "OK", files: [], voices: [], modelSlots: [] }));
        const client = new ServerRestClient("");
        await client.stopSounds();
        await client.deleteSound("clip.wav");
        await client.getTtsVoices();
        await client.deleteModel(4);
        expect(fetchMock.mock.calls.map(call => [String(call[0]), call[1]!.method])).toEqual([
            ["/soundboard/stop", "POST"],
            ["/soundboard/delete", "POST"],
            ["/tts/voices", undefined],
            ["/delete_model", "POST"],
        ]);
        expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ filename: "clip.wav" });
        expect((fetchMock.mock.calls[3][1]!.body as FormData).get("slot")).toBe("4");
    });
});
