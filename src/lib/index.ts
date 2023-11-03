import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { Plugin } from "esbuild";
import type { NormalizedPackageJson } from "esbuild-plugin-bundles-list";
import bundlesList from "esbuild-plugin-bundles-list";

import { File } from "./File.js";

const pluginName = "copy-licenses";

function compare(ignorecase: boolean, fileName: string, prefix: string) {
    return ignorecase ? fileName.toLowerCase().startsWith(prefix.toLowerCase()) : fileName.startsWith(prefix);
}

async function copyFiles(
    srcDir: string,
    targetDir: string,
    searchNames: readonly string[],
    ignoreCase: boolean,
): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });

    const files = await fs.readdir(srcDir);

    for (const file of files) {
        if (searchNames.some(compare.bind(null, ignoreCase, file))) {
            // eslint-disable-next-line no-await-in-loop
            await fs.copyFile(path.join(srcDir, file), path.join(targetDir, file), fsConstants.COPYFILE_FICLONE);
        }
    }
}

export interface Options {
    copyLicenseFiles?: {
        enabled?: boolean;
        directoryPath?: string;
        licenseFileNamePrefixes?: string[];
        licenseFileNameIgnoreCase?: boolean;
    };
    summaryFile?: {
        enabled?: boolean;
        filePath?: string;
        header?: string;
        summaryGenerator?: SummaryGenerator;
        append?: boolean;
        atomicWrite?: boolean;
    };
    ignorePrivate?: boolean;
}

export type SummaryGenerator = (packageJson: NormalizedPackageJson) => string;

function formatWithTitle(title: string, content: string | undefined) {
    if (content === "" || content === undefined) {
        return "";
    }
    return `- ${title}: ${content}\n`;
}

const defaultSummaryGenerator: SummaryGenerator = (packageJson) => {
    const { name, version, description = "", license, homepage, author: { name: authorName } = {} } = packageJson;

    let content = `---\n## ${name}@${version}\n`;

    content += formatWithTitle("License", license);
    content += formatWithTitle("Author", authorName);
    content += formatWithTitle("Homepage", homepage);

    content += `\n${description}\n\n`;

    return content;
};

export default function copyBundlesLicenses(options: Options = {}): Plugin {
    const x = bundlesList({
        func: async (bundled) => {
            // extract options
            const {
                copyLicenseFiles: {
                    enabled: clfEnabled = true,
                    directoryPath: clfDirectoryPath = "./LICENSE-BUNDLED-DEPENDENCIES/",
                    licenseFileNamePrefixes = ["LICENSE", "LICENCE", "NOTICE"],
                    licenseFileNameIgnoreCase = true,
                } = {},
                summaryFile: {
                    enabled: sfEnabled = true,
                    filePath: sfFilePath = "./LICENSE-BUNDLED-DEPENDENCIES/summary.md",
                    header: sfHeader = "# Bundled dependencies\nThis project includes the following software:\n\n",
                    summaryGenerator = defaultSummaryGenerator,
                    append: sfAppend = false,
                    atomicWrite = true,
                } = {},
                ignorePrivate = true,
            } = options;

            // ignore private packages
            if (ignorePrivate) {
                bundled = bundled.filter((it) => it.packageJson.private !== true);
            }

            // no bundled packages, nothing to do
            if (bundled.length < 1) {
                return;
            }

            // copy License files of bundled dependencies
            if (clfEnabled) {
                await fs.mkdir(clfDirectoryPath, { recursive: true });

                for (const { packageJson, packageJsonPath } of bundled) {
                    // eslint-disable-next-line no-await-in-loop
                    await copyFiles(
                        path.dirname(packageJsonPath),
                        path.join(clfDirectoryPath, `${packageJson.name}@${packageJson.version}`),
                        licenseFileNamePrefixes,
                        licenseFileNameIgnoreCase,
                    );
                }
            }

            // create a summary file
            if (sfEnabled) {
                const f = await (atomicWrite
                    ? File.open(sfFilePath, sfAppend)
                    : fs.open(sfFilePath, sfAppend ? "a" : "w"));

                try {
                    await f.writeFile(sfHeader);

                    for (const { packageJson } of bundled) {
                        // eslint-disable-next-line no-await-in-loop
                        await f.writeFile(summaryGenerator(packageJson));
                    }
                } finally {
                    await f.close();
                }
            }
        },
    });

    return {
        ...x,
        name: pluginName,
    };
}
