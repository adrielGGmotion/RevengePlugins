import { findByProps } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

const DocumentPicker = findByProps("pickSingle", "isCancel") as any;
const DocumentsNew = findByProps("pick", "saveDocuments") as any;

const nmp = (window as any).nativeModuleProxy;
function getNativeModule(...names: string[]) {
	for (const name of names) {
		if ((globalThis as any).__turboModuleProxy) {
			const m = (globalThis as any).__turboModuleProxy(name);
			if (m) return m;
		}
		if (nmp?.[name]) return nmp[name];
	}
}

const RNFileModule = getNativeModule("NativeFileModule", "DCDFileManager") as any;

function parseLink(link: string) {
	const path = link.split("://");
	return `/${path[1]}`;
}

function getPluginsFilePath() {
	const docsDir = RNFileModule?.getConstants?.()?.DocumentsDirPath
		?? RNFileModule?.DocumentsDirPath;
	return `${docsDir}/vendetta/VENDETTA_PLUGINS.json`;
}

async function readPluginsStore(): Promise<Record<string, any>> {
	try {
		const path = getPluginsFilePath();
		const exists = await RNFileModule.fileExists(path);
		if (!exists) return {};
		const content = await RNFileModule.readFile(path, "utf8");
		return JSON.parse(content) ?? {};
	} catch {
		return {};
	}
}

async function writePluginsStore(data: Record<string, any>) {
	await RNFileModule.writeFile(
		"documents",
		"vendetta/VENDETTA_PLUGINS.json",
		JSON.stringify(data),
		"utf8",
	);
}

async function pickAndInstall() {
	if (!DocumentPicker && !DocumentsNew) {
		showToast("File picker not available on this device", getAssetIDByName("XIcon"));
		return;
	}

	let js: string | null = null;
	let pluginName = "unknown";

	try {
		if (DocumentPicker) {
			const { fileCopyUri, name } = await DocumentPicker.pickSingle({
				type: [DocumentPicker.types.allFiles],
				mode: "import",
				copyTo: "cachesDirectory",
			});

			if (!fileCopyUri) {
				showToast("Could not read file", getAssetIDByName("XIcon"));
				return;
			}

			if (!name?.endsWith(".js")) {
				showToast("Select a .js plugin file", getAssetIDByName("XIcon"));
				return;
			}

			js = await RNFileModule.readFile(parseLink(fileCopyUri), "utf8");
			pluginName = name.replace(".js", "");
		} else if (DocumentsNew) {
			const [{ uri, name, error }] = await DocumentsNew.pick({
				type: DocumentsNew.types.allFiles,
				allowVirtualFiles: true,
				mode: "import",
			});

			if (error) throw new Error(error);
			if (!name?.endsWith(".js")) {
				showToast("Select a .js plugin file", getAssetIDByName("XIcon"));
				return;
			}

			const [copyResult] = await DocumentsNew.keepLocalCopy({
				files: [{ fileName: name, uri }],
				destination: "cachesDirectory",
			});

			if (copyResult.status !== "success") throw new Error(copyResult.copyError);

			js = await RNFileModule.readFile(parseLink(copyResult.localUri), "utf8");
			pluginName = name.replace(".js", "");
		}

		if (!js) return;

		const pluginId = `local:${pluginName}/`;
		const store = await readPluginsStore();

		if (store[pluginId]) {
			showToast(`"${pluginName}" is already installed`, getAssetIDByName("XIcon"));
			return;
		}

		store[pluginId] = {
			id: pluginId,
			manifest: {
				name: pluginName,
				description: "Locally installed plugin",
				authors: [{ name: "local", id: "0" }],
				main: "index.js",
			},
			enabled: true,
			update: false,
			js,
		};

		await writePluginsStore(store);

		try {
			await (window as any).vendetta?.plugins?.startPlugin?.(pluginId);
		} catch {
			// May need a restart
		}

		showToast(`Installed "${pluginName}"! Restart if it doesn't appear.`, getAssetIDByName("CheckmarkLargeIcon"));
	} catch (err: any) {
		if (!DocumentPicker?.isCancel?.(err)) {
			showToast(`Error: ${err?.message ?? String(err)}`, getAssetIDByName("XIcon"));
		}
	}
}

export function onLoad() {}
export function onUnload() {}

export const settings = () => (
	<RN.View style={{ padding: 16 }}>
		<RN.Text style={{ color: "white", fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
			Local Plugin Installer
		</RN.Text>
		<RN.Text style={{ color: "#aaa", fontSize: 14, marginBottom: 16 }}>
			Install a plugin directly from a .js file on your device. The plugin won't auto-update.
		</RN.Text>
		<RN.TouchableOpacity
			onPress={pickAndInstall}
			style={{
				backgroundColor: "#5865F2",
				borderRadius: 8,
				padding: 14,
				alignItems: "center",
			}}
		>
			<RN.Text style={{ color: "white", fontWeight: "bold", fontSize: 15 }}>
				Pick Plugin File (.js)
			</RN.Text>
		</RN.TouchableOpacity>
	</RN.View>
);
