import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { File } from "./File.js";

let tempdir: string;

beforeAll(async () => {
    tempdir = await fs.mkdtemp(path.join(os.tmpdir(), "File.test.ts-"));
});

afterAll(async () => {
    await fs.rm(tempdir, { recursive: true, force: true });
});

function getTempFilePath() {
    return path.join(tempdir, Math.random().toString(36));
}

async function expectNoGabage(tempfile: string): Promise<void> {
    const files = await fs.readdir(path.dirname(tempfile), { withFileTypes: true });

    const tempfileName = path.basename(tempfile);

    expect(files.filter((it) => it.name !== tempfileName && it.name.startsWith(tempfileName))).toHaveLength(0);
}

describe("The file does not exist yet", () => {
    it.each([{ append: true }, { append: false }])("append: $append", async ({ append }) => {
        const p = getTempFilePath();

        const f = await File.open(p, append);
        await f.writeFile("foo");
        await f.writeFile("bar");
        await f.close();

        const result = await fs.readFile(p, { encoding: "utf-8" });

        expect(result).toBe("foobar");
        await expectNoGabage(p);
    });
});

describe("The file already exists", () => {
    it.each([
        { append: true, expected: "current-data-foobar" },
        { append: false, expected: "foobar" },
    ])("append: $append", async ({ append, expected }) => {
        const p = getTempFilePath();

        await fs.writeFile(p, "current-data-");

        const mode = 0o672;

        await fs.chmod(p, mode);

        const f = await File.open(p, append);
        await f.writeFile("foo");
        await f.writeFile("bar");
        await f.close();

        const result = await fs.readFile(p, { encoding: "utf-8" });

        expect(result).toBe(expected);

        await expectNoGabage(p);

        const modeResult = (await fs.stat(p)).mode & 0o777;

        // ファイルモードが同一かどうか。
        // 結果が分かりやすいように、8進数表示に変換している。
        expect(modeResult.toString(8)).toBe(mode.toString(8));
    });
});

test("close multiple times", async () => {
    const p = getTempFilePath();

    const f = await File.open(p, false);
    await f.writeFile("foo");
    await f.writeFile("bar");
    await f.close();
    await f.close();
    await f.close();

    const result = await fs.readFile(p, { encoding: "utf-8" });

    expect(result).toBe("foobar");
});

describe("directory", () => {
    it.each([{ append: true }, { append: false }])("append: $append", async ({ append }) => {
        const p = getTempFilePath();
        await fs.mkdir(p);

        await expect(async () => {
            await File.open(p, append);
        }).rejects.toThrow(p);

        await expectNoGabage(p);
    });
});

test("current file is not readable", async () => {
    const p = getTempFilePath();

    await fs.writeFile(p, "current-data-");

    // unable to read
    await fs.chmod(p, 0o000);

    await expect(async () => {
        await File.open(p, true);
    }).rejects.toThrow();

    await expectNoGabage(p);
});
