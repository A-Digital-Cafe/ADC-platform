import { Buffer } from "node:buffer";
import { IFileAdapter } from "../../../interfaces/modules/utilities/adapters/IFIleAdapter.js";
import { Logger } from "../../../utils/logger/Logger.js";
import { BaseUtility } from "../../BaseUtility.js";

export default class JsonAdapterUtility extends BaseUtility implements IFileAdapter<any> {
	public readonly name = "json-file-adapter";
	toBuffer(data: any): Buffer {
		try {
			const jsonString = JSON.stringify(data, null, 2);
			return Buffer.from(jsonString, "utf-8");
		} catch (err: any) {
			Logger.error("[JsonAdapter] Error al serializar a Buffer:" + err.message);
			return Buffer.alloc(0);
		}
	}

	fromBuffer<T>(buffer: Buffer): T {
		if (buffer.byteLength === 0) {
			const errorMsg = "[JsonAdapter] Error: No se puede parsear un buffer vacío.";
			Logger.error(errorMsg);
			throw new Error(errorMsg);
		}

		try {
			const jsonString = buffer.toString("utf-8");
			return JSON.parse(jsonString) as T;
		} catch (err: any) {
			Logger.error("[JsonAdapter] Error al parsear desde Buffer: " + err.message);
			throw new Error(`[JsonAdapter] Error al parsear JSON: ${err.message}`, { cause: err });
		}
	}
}
