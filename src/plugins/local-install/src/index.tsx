import { unzipSync, strFromU8 } from "fflate";
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
	return `/${link.split("://")[1]}`;
}

const PLUGINS_STORE = "vd_mmkv/VENDETTA_PLUGINS";

async function readPluginsStore(): Promise<Record<string, any>> {
	try {
		const docsDir = RNFileModule?.getConstants?.()?.DocumentsDirPath ?? RNFileModule?.DocumentsDirPath;
		const fullPath = `${docsDir}/${PLUGINS_STORE}`;
		if (!await RNFileModule.fileExists(fullPath)) return {};
		return JSON.parse(await RNFileModule.readFile(fullPath, "utf8")) ?? {};
	} catch {
		return {};
	}
}

async function writePluginsStore(data: Record<string, any>) {
	await RNFileModule.writeFile("documents", PLUGINS_STORE, JSON.stringify(data), "utf8");
}

async function readFileAsBase64(uri: string): Promise<Uint8Array> {
	const b64 = await RNFileModule.readFile(parseLink(uri), "base64");
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function pickAndInstall() {
	if (!DocumentPicker && !DocumentsNew) {
		showToast("File picker not available", getAssetIDByName("XIcon"));
		return;
	}

	try {
		let fileCopyUri: string | null = null;
		let fileName: string | null = null;

		if (DocumentPicker) {
			const result = await DocumentPicker.pickSingle({
				type: [DocumentPicker.types.allFiles],
				mode: "import",
				copyTo: "cachesDirectory",
			});
			fileCopyUri = result.fileCopyUri;
			fileName = result.name;
		} else if (DocumentsNew) {
			const [{ uri, name, error }] = await DocumentsNew.pick({
				type: DocumentsNew.types.allFiles,
				allowVirtualFiles: true,
				mode: "import",
			});
			if (error) throw new Error(error);
			const [copyResult] = await DocumentsNew.keepLocalCopy({
				files: [{ fileName: name, uri }],
				destination: "cachesDirectory",
			});
			if (copyResult.status !== "success") throw new Error(copyResult.copyError);
			fileCopyUri = copyResult.localUri;
			fileName = name;
		}

		if (!fileCopyUri || !fileName) return;

		let js: string | null = null;
		let manifest: any = null;

		if (fileName.endsWith(".zip")) {
			// Read as base64 and decode to bytes for fflate
			const bytes = await readFileAsBase64(fileCopyUri);
			const unzipped = unzipSync(bytes);

			// Find manifest.json and index.js inside the zip
			const manifestEntry = Object.keys(unzipped).find(k => k.endsWith("manifest.json"));
			const jsEntry = Object.keys(unzipped).find(k => k.endsWith("index.js"));

			if (!manifestEntry || !jsEntry) {
				showToast("Zip must contain manifest.json and index.js", getAssetIDByName("XIcon"));
				return;
			}

			manifest = JSON.parse(strFromU8(unzipped[manifestEntry]));
			js = strFromU8(unzipped[jsEntry]);
		} else if (fileName.endsWith(".js")) {
			js = await RNFileModule.readFile(parseLink(fileCopyUri), "utf8");
			manifest = {
				name: fileName.replace(".js", ""),
				description: "Locally installed plugin",
				authors: [{ name: "local", id: "0" }],
				main: "index.js",
			};
		} else {
			showToast("Select a .zip or .js plugin file", getAssetIDByName("XIcon"));
			return;
		}

		if (!js || !manifest) return;

		// Use a fake https URL as the plugin ID so Kettu treats it normally
		const pluginId = `https://local.install/${manifest.name}/`;
		const store = await readPluginsStore();

		if (store[pluginId]) {
			showToast(`"${manifest.name}" is already installed`, getAssetIDByName("XIcon"));
			return;
		}

		store[pluginId] = {
			id: pluginId,
			manifest,
			enabled: true,
			update: false,
			js,
		};

		await writePluginsStore(store);

		try {
			await (window as any).vendetta?.plugins?.startPlugin?.(pluginId);
			showToast(`Installed "${manifest.name}"!`, getAssetIDByName("CheckmarkLargeIcon"));
		} catch {
			showToast(`Installed "${manifest.name}"! Restart to activate.`, getAssetIDByName("CheckmarkLargeIcon"));
		}
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
			Install a plugin from a .zip (with manifest.json + index.js) or a .js file.
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
				Pick Plugin File (.zip or .js)
			</RN.Text>
		</RN.TouchableOpacity>
	</RN.View>
);
