import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

function isENOENT(e: unknown): boolean {
    return typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
}

async function stat(p: string): Promise<Stats | undefined> {
    try {
        return await fs.stat(p);
    } catch (e) {
        if (isENOENT(e)) {
            return undefined;
        }
        throw e;
    }
}

export class File {
    public static async open(p: string, append: boolean): Promise<File> {
        const tempdir = await fs.mkdtemp(`${p}-tmp-`);

        try {
            const tempfile = path.join(tempdir, "tmp");

            const st = await stat(p);

            if (st !== undefined && !st.isFile()) {
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                throw new Error(`Opening file is not a file: ${p}`);
            }

            if (append) {
                try {
                    await fs.copyFile(p, tempfile, fs.constants.COPYFILE_FICLONE);
                } catch (e) {
                    if (isENOENT(e)) {
                        // do nothing
                    } else {
                        throw e;
                    }
                }
            }

            const fd = await fs.open(tempfile, append ? "a" : "w");

            // 既存ファイルがある場合はモードを変更する
            // open時の指定はumaskの影響を受けるため、明示的にchmodする必要がある
            if (st !== undefined) {
                await fd.chmod(st.mode);
            }

            return new File(fd, p, tempfile);
        } catch (e) {
            await fs.rm(tempdir, { recursive: true, force: true });
            throw e;
        }
    }

    readonly #fd: fs.FileHandle;

    readonly #tempFilePath: string;

    readonly #path: string;

    #closed = false;

    private constructor(fd: fs.FileHandle, p: string, tempFilePath: string) {
        this.#fd = fd;
        this.#path = p;
        this.#tempFilePath = tempFilePath;
    }

    public writeFile(str: string): Promise<void> {
        return this.#fd.writeFile(str);
    }

    /**
     * これまでに書き込んだ内容をファイルに反映する。失敗した場合も、書き込んだ内容は削除される。
     */
    public async close(): Promise<void> {
        if (this.#closed) {
            return;
        }

        this.#closed = true;

        try {
            await this.#fd.datasync();
            await fs.rename(this.#tempFilePath, this.#path);
        } finally {
            await this.#fd.close();
            await fs.rm(path.dirname(this.#tempFilePath), { recursive: true, force: true });
        }
    }
}
